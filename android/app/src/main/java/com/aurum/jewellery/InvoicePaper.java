package com.aurum.jewellery;

import android.print.PrintAttributes;

final class InvoicePaper {
    private InvoicePaper() {}
    static PrintAttributes forFormat(String format) {
        PrintAttributes.MediaSize media;
        switch (format) {
            case "A4": media = PrintAttributes.MediaSize.ISO_A4; break;
            case "A5": media = PrintAttributes.MediaSize.ISO_A5; break;
            case "80mm": case "58mm":
                int width = format.equals("80mm") ? 80 : 58;
                media = new PrintAttributes.MediaSize("ROLL_" + width, width + " × 200 mm", mils(width), mils(200)); break;
            default: throw new IllegalArgumentException("Unknown invoice paper format");
        }
        return new PrintAttributes.Builder().setMediaSize(media).setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .setColorMode(PrintAttributes.COLOR_MODE_COLOR).build();
    }
    private static int mils(int mm) {return (int)Math.round(mm * 1000.0 / 25.4);}
}
