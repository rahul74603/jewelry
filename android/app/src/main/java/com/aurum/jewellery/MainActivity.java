package com.aurum.jewellery;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceVault.class);
        registerPlugin(DriveFolderPlugin.class);
        registerPlugin(SmsReminderPlugin.class);
        registerPlugin(BackupSchedulerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
