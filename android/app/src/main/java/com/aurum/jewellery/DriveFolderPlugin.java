package com.aurum.jewellery;

import android.app.Activity;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Google Drive cloud backup via the Android Storage Access Framework.
 *
 * Why SAF and not the Google Drive REST API: an Android OAuth client
 * is tied to the app's package name + SHA-1 signing fingerprint, and
 * Aurum's CI builds are DEBUG APKs with a disposable debug signing
 * key (a fresh key on every run), so no registered OAuth client can
 * ever match these builds — the Drive API would fail with
 * "UnregisteredOnApiConsole" exactly as it does for other open-source
 * apps that self-build. SAF needs no Google Cloud project, no OAuth
 * client id and no signing fingerprint: the shopkeeper picks a folder
 * once in the system picker (Google Drive appears there through the
 * Drive app's DocumentsProvider), the permission is persisted with
 * takePersistableUriPermission so it survives restarts, and every
 * backup is written into that folder with DocumentsContract.
 *
 * Overwrite is delete-then-create: SAF providers (Drive included)
 * do not reliably overwrite a document in place, and creating a
 * document with an existing name can silently produce a "(1)"
 * duplicate instead. The yearly backup file is therefore replaced
 * by name on every upload, so there is always exactly one current
 * file in the Drive folder.
 *
 * Framework APIs only (DocumentsContract + ContentResolver) — no new
 * Gradle dependency. Requires the Google Drive app installed on the
 * phone; without it Drive simply does not appear in the picker.
 */
@CapacitorPlugin(name = "DriveFolder")
public class DriveFolderPlugin extends Plugin {
    private static final int READ_WRITE =
        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final String MIME_JSON = "application/json";
    private static final String[] NAME_PROJECTION = {
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
    };
    private static final String[] CHILD_PROJECTION = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
    };

    private static Uri treeDocUri(Uri treeUri) {
        return DocumentsContract.buildDocumentUriUsingTree(
            treeUri, DocumentsContract.getTreeDocumentId(treeUri));
    }

    private boolean hasPersistedAccess(Uri treeUri) {
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(treeUri) && p.isReadPermission() && p.isWritePermission())
                return true;
        }
        return false;
    }

    private String queryDisplayName(Uri docUri) {
        try (Cursor c = getContext().getContentResolver().query(
                docUri, NAME_PROJECTION, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                return name == null ? "" : name;
            }
        }
        return "";
    }

    /** Find the child document with this display name, or null. */
    private Uri findChild(Uri treeUri, String filename) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri, DocumentsContract.getTreeDocumentId(treeUri));
        try (Cursor c = getContext().getContentResolver().query(
                childrenUri, CHILD_PROJECTION, null, null, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                String id = c.getString(0);
                String name = c.getString(1);
                if (filename.equals(name))
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
            }
        }
        return null;
    }

    private String requiredUri(PluginCall call) {
        String uri = call.getString("uri", "");
        return (uri == null || uri.isEmpty()) ? "" : uri;
    }

    private String requiredFilename(PluginCall call) {
        String name = call.getString("filename", "");
        return (name == null || name.isEmpty()) ? "" : name;
    }

    @PluginMethod public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(READ_WRITE
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        // Open the picker inside Google Drive when the Drive app is
        // installed: without this, DocumentsUI opens on local storage
        // and the shopkeeper has to hunt for Drive in the drawer menu.
        // An unknown/unavailable URI is ignored by DocumentsUI, so
        // this degrades gracefully to the default location.
        Uri driveRoot = driveRootUri();
        if (driveRoot == null) {
            // No Drive provider on this phone (Drive app not
            // installed): say so clearly instead of opening local
            // storage and letting the shopkeeper hunt for Drive.
            call.reject("drive-app-missing");
            return;
        }
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, driveRoot);
        try {
            startActivityForResult(call, intent, "pickFolderResult");
        } catch (Exception e) {
            call.reject("No folder picker available on this phone");
        }
    }

    /**
     * The root document of the Google Drive DocumentsProvider, found
     * by querying its roots (the documented way to discover them).
     * Returns null when Drive is not installed / unavailable.
     */
    private Uri driveRootUri() {
        try (Cursor c = getContext().getContentResolver().query(
                DocumentsContract.buildRootsUri("com.google.android.apps.docs.storage"),
                new String[]{DocumentsContract.Root.COLUMN_DOCUMENT_ID},
                null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String docId = c.getString(0);
                if (docId != null && !docId.isEmpty()) {
                    return DocumentsContract.buildDocumentUri(
                        "com.google.android.apps.docs.storage", docId);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    @ActivityCallback private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            JSObject out = new JSObject();
            out.put("picked", false);
            call.resolve(out);
            return;
        }
        Uri treeUri = result.getData().getData();
        if (!"content".equals(treeUri.getScheme())) {
            call.reject("No folder selected");
            return;
        }
        try {
            getContext().getContentResolver()
                .takePersistableUriPermission(treeUri, READ_WRITE);
        } catch (Exception e) {
            call.reject("could-not-keep-access");
            return;
        }
        String name = queryDisplayName(treeDocUri(treeUri));
        JSObject out = new JSObject();
        out.put("picked", true);
        out.put("uri", treeUri.toString());
        out.put("name", name.isEmpty() ? "Google Drive folder" : name);
        call.resolve(out);
    }

    @PluginMethod public void writeFile(PluginCall call) {
        String uriText = requiredUri(call);
        String filename = requiredFilename(call);
        String content = call.getString("content", "");
        if (uriText.isEmpty() || filename.isEmpty() || content == null) {
            call.reject("Missing folder, filename or backup content");
            return;
        }
        Uri treeUri = Uri.parse(uriText);
        bridge.execute(() -> {
            try {
                if (!hasPersistedAccess(treeUri)) {
                    call.reject("permission-revoked");
                    return;
                }
                Uri existing = findChild(treeUri, filename);
                if (existing != null) {
                    boolean deleted = DocumentsContract.deleteDocument(
                        getContext().getContentResolver(), existing);
                    if (!deleted) {
                        call.reject("could-not-replace");
                        return;
                    }
                }
                Uri docUri = DocumentsContract.createDocument(
                    getContext().getContentResolver(),
                    treeDocUri(treeUri), MIME_JSON, filename);
                if (docUri == null) {
                    call.reject("could-not-create");
                    return;
                }
                try (OutputStream out = getContext().getContentResolver()
                        .openOutputStream(docUri, "w")) {
                    if (out == null) throw new IllegalStateException();
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                JSObject result = new JSObject();
                result.put("written", true);
                call.resolve(result);
            } catch (SecurityException e) {
                call.reject("permission-revoked");
            } catch (Exception e) {
                call.reject("write-failed");
            }
        });
    }

    @PluginMethod public void readFile(PluginCall call) {
        String uriText = requiredUri(call);
        String filename = requiredFilename(call);
        if (uriText.isEmpty() || filename.isEmpty()) {
            call.reject("Missing folder or filename");
            return;
        }
        Uri treeUri = Uri.parse(uriText);
        bridge.execute(() -> {
            try {
                if (!hasPersistedAccess(treeUri)) {
                    call.reject("permission-revoked");
                    return;
                }
                Uri docUri = findChild(treeUri, filename);
                JSObject result = new JSObject();
                if (docUri == null) {
                    result.put("found", false);
                    call.resolve(result);
                    return;
                }
                try (InputStream in = getContext().getContentResolver().openInputStream(docUri)) {
                    if (in == null) throw new IllegalStateException();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int n;
                    while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
                    result.put("found", true);
                    result.put("content", buf.toString(StandardCharsets.UTF_8.name()));
                }
                call.resolve(result);
            } catch (SecurityException e) {
                call.reject("permission-revoked");
            } catch (Exception e) {
                call.reject("read-failed");
            }
        });
    }

    @PluginMethod public void checkAccess(PluginCall call) {
        String uriText = requiredUri(call);
        if (uriText.isEmpty()) {
            call.reject("Missing folder");
            return;
        }
        Uri treeUri = Uri.parse(uriText);
        bridge.execute(() -> {
            JSObject result = new JSObject();
            try {
                if (!hasPersistedAccess(treeUri)) {
                    result.put("ok", false);
                    result.put("reason", "permission-revoked");
                    call.resolve(result);
                    return;
                }
                // Listing the folder itself proves the tree is still
                // reachable; a deleted folder throws or comes back empty.
                String name = queryDisplayName(treeDocUri(treeUri));
                if (name.isEmpty()) {
                    result.put("ok", false);
                    result.put("reason", "folder-missing");
                } else {
                    result.put("ok", true);
                }
                call.resolve(result);
            } catch (SecurityException e) {
                result.put("ok", false);
                result.put("reason", "permission-revoked");
                call.resolve(result);
            } catch (Exception e) {
                result.put("ok", false);
                result.put("reason", "folder-missing");
                call.resolve(result);
            }
        });
    }

    @PluginMethod public void releaseFolder(PluginCall call) {
        String uriText = requiredUri(call);
        if (!uriText.isEmpty()) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                    Uri.parse(uriText), READ_WRITE);
            } catch (Exception ignored) {
                // Already released or never held — disconnect anyway.
            }
        }
        call.resolve();
    }
}
