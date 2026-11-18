package com.aurum.jewellery;
import org.junit.Test;
public class DeviceKeyInputTest {
    @Test(expected=IllegalArgumentException.class) public void rejectsUnscopedMessages() { DeviceKeys.checkMessage("unrelated text"); }
    @Test(expected=IllegalArgumentException.class) public void rejectsInvalidSlot() { DeviceKeys.alias(""); }
}
