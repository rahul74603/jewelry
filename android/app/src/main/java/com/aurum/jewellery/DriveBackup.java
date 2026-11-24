package com.aurum.jewellery;

import android.content.ContentResolver;
import android.content.Context;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.OutputStream;

/**
 * Writes the nightly backup into the connected Google Drive folder.
 *
 * Same rules as the manual backup in DriveFolderPlugin (which this
 * mirrors, without the Capacitor bridge — a background worker has
 * only a Context): overwrite is delete-then-create, because SAF
 * providers (Drive included) do not reliably overwrite a document
 * in place, and creating a document with an existing name can
 * silently produce a "(1)" duplicate. The yearly file is therefore
 * replaced by name on every run, so there is always exactly one
 * current file in the Drive folder.
 *
 * Returns "ok" or a reason code ("not-connected",
 * "permission-revoked", "folder-missing", "could-not-create",
 * "could-not-replace", "write-failed"). Never throws.
 */
public final class DriveBackup {
    private static final int READ_WRITE =
        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
            | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final String MIME_JSON = "application/json";
    private static final String[] CHILD_PROJECTION = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
    };

    private DriveBackup() {}

    private static Uri treeDocUri(Uri treeUri) {
        return DocumentsContract.buildDocumentUriUsingTree(
            treeUri, DocumentsContract.getTreeDocumentId(treeUri));
    }

    private static boolean hasPersistedAccess(Context context, Uri treeUri) {
        for (UriPermission p : context.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(treeUri) && p.isReadPermission() && p.isWritePermission())
                return true;
        }
        return false;
    }

    /** Find the child document with this display name, or null. */
    private static Uri findChild(Context context, Uri treeUri, String filename) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri, DocumentsContract.getTreeDocumentId(treeUri));
        try (Cursor c = context.getContentResolver().query(
                childrenUri, CHILD_PROJECTION, null, null, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                String id = c.getString(0);
                String name = c.getString(1);
                if (filename.equals(name))
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    public static String writeToDriveFolder(
            Context context, String treeUriText, String filename, byte[] bytes) {
        if (treeUriText == null || treeUriText.isEmpty()) return "not-connected";
        Uri treeUri = Uri.parse(treeUriText);
        ContentResolver resolver = context.getContentResolver();
        try {
            if (!hasPersistedAccess(context, treeUri)) return "permission-revoked";
            Uri existing = findChild(context, treeUri, filename);
            if (existing != null) {
                boolean deleted = DocumentsContract.deleteDocument(resolver, existing);
                if (!deleted) return "could-not-replace";
            }
            Uri docUri = DocumentsContract.createDocument(
                resolver, treeDocUri(treeUri), MIME_JSON, filename);
            if (docUri == null) return "could-not-create";
            try (OutputStream out = resolver.openOutputStream(docUri, "w")) {
                if (out == null) throw new IllegalStateException();
                out.write(bytes);
            }
            return "ok";
        } catch (SecurityException e) {
            return "permission-revoked";
        } catch (Exception e) {
            return "write-failed";
        }
    }
}
