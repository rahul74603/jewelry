package com.aurum.jewellery;

import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;

/** Searchable, on-device vector fallback when PrintSpooler substitutes Letter.
 * Layout at 4x in logical units; the PDF page itself uses PostScript points.
 * This writer knows nothing about GST, stock, payments or tenant records. */
final class RollPdf implements AutoCloseable {
    private final PdfDocument doc = new PdfDocument();
    private PdfDocument.Page page;
    private Canvas canvas;
    private final int width, height = points(200), margin, usable;
    private int y, pages;
    private static final int SCALE = 4;
    private static final int INK = 0xff30251e, COPPER = 0xff95501e, GOLD = 0xfff8dfb2;
    private RollPdf(String format) {
        if (!format.equals("80mm") && !format.equals("58mm")) throw new IllegalArgumentException("Invalid roll");
        width = points(format.equals("80mm") ? 80 : 58);
        margin = points(format.equals("80mm") ? 3 : 2) * SCALE;
        usable = width*SCALE - 2*margin;
    }
    private static int points(int mm) { return (int)Math.round(mm*72.0/25.4); }
    private void nextPage() {
        if (page != null) doc.finishPage(page);
        page = doc.startPage(new PdfDocument.PageInfo.Builder(width,height,++pages).create());
        canvas=page.getCanvas(); canvas.scale(1f/SCALE,1f/SCALE); y=margin;
    }
    private int remaining() { return height*SCALE-margin-y; }
    private void reserve(int h) { if (remaining()<h && y>margin) nextPage(); }
    private static StaticLayout layout(String text, int width, float pt, boolean bold, int color, Layout.Alignment align) {
        TextPaint p=new TextPaint(Paint.ANTI_ALIAS_FLAG|Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(Typeface.create("sans-serif",bold?Typeface.BOLD:Typeface.NORMAL));p.setColor(color);p.setTextSize(pt*SCALE);
        return StaticLayout.Builder.obtain(text,0,text.length(),p,width).setAlignment(align).setIncludePad(true).build();
    }
    private void rect(int x,int top,int w,int h,int color) {
        Paint p=new Paint();p.setColor(color);canvas.drawRect(x,top,x+w,top+h,p);
    }
    private void draw(StaticLayout l,int x,int top) {
        int save=canvas.save();canvas.translate(x,top);l.draw(canvas);canvas.restoreToCount(save);
    }
    private void paragraph(String text,String kind) {
        boolean brand=kind.equals("brand"), section=kind.equals("section"), footer=kind.equals("footer");
        boolean center=brand||footer||kind.equals("center");
        boolean bold=brand||section||kind.equals("title")||kind.equals("item")||kind.equals("sign");
        StaticLayout l=layout(text,usable-8,brand?13:section?9:8,bold,section?COPPER:INK,center?Layout.Alignment.ALIGN_CENTER:Layout.Alignment.ALIGN_NORMAL);
        int before=(section||kind.equals("sign")?5:1)*SCALE;
        reserve(before+Math.min(l.getHeight(),16*SCALE)+(section?12*SCALE:0));y+=before;
        // Split long terms/addresses only BETWEEN glyph lines. Never allocate a
        // blank trailing sheet or cut the signature off in a fixed-height box.
        for(int line=0;line<l.getLineCount();) {
            int top=l.getLineTop(line),end=line+1;
            reserve(l.getLineBottom(line)-top);
            while(end<l.getLineCount() && l.getLineBottom(end)-top<=remaining())end++;
            int h=l.getLineBottom(end-1)-top;
            if(brand||footer)rect(margin,y,usable,h,GOLD);
            int save=canvas.save();canvas.clipRect(margin,y,margin+usable,y+h);draw(l,margin+4,y-top);canvas.restoreToCount(save);
            y+=h;line=end;if(line<l.getLineCount())nextPage();
        }
        if(section)rect(margin,y,usable,2,COPPER);
    }
    private void row(String label,String value,boolean total) {
        int gap=3*SCALE;
        int right=(int)(usable*0.56); // large, grouped INR values retain the right edge
        StaticLayout v=layout(value,right,8,total,INK,Layout.Alignment.ALIGN_OPPOSITE);
        StaticLayout k=layout(label,usable-right-gap,8,total,INK,Layout.Alignment.ALIGN_NORMAL);
        int h=Math.max(k.getHeight(),v.getHeight())+4;
        if(h>height*SCALE-2*margin){paragraph(label,"section");paragraph(value,"text");return;}
        reserve(h);if(total)rect(margin,y,usable,h,GOLD);draw(k,margin,y+2);draw(v,margin+usable-right,y+2);y+=h;
    }
    private static Bitmap image(String uri) {
        if(uri==null||uri.isEmpty())return null;
        if(uri.length()>150000 || !uri.matches("data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+"))throw new IllegalArgumentException("Invalid artwork");
        byte[] bytes=Base64.decode(uri.substring(uri.indexOf(',')+1),Base64.DEFAULT);
        BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,o);
        if(o.outWidth<1||o.outHeight<1)throw new IllegalArgumentException("Invalid artwork");
        o.inJustDecodeBounds=false;o.inSampleSize=1;while(Math.max(o.outHeight,o.outWidth)/o.inSampleSize>600)o.inSampleSize*=2;
        return BitmapFactory.decodeByteArray(bytes,0,bytes.length,o);
    }
    private void artwork(String uri,boolean right) {
        Bitmap b=image(uri);if(b==null)return;
        float scale=Math.min(usable*.42f/b.getWidth(),23f*SCALE/b.getHeight());float w=b.getWidth()*scale,h=b.getHeight()*scale;
        float x=right?margin+usable-w:margin;canvas.drawBitmap(b,null,new RectF(x,y,x+w,y+h),new Paint(Paint.FILTER_BITMAP_FLAG));b.recycle();
    }
    static void write(OutputStream out,String format,JSONArray blocks,String logo,String mark) throws Exception {
        if(blocks==null||blocks.length()<1||blocks.length()>1000)throw new IllegalArgumentException("Invalid receipt");
        try(RollPdf p=new RollPdf(format)) {
            p.nextPage();if(!logo.isEmpty()||!mark.isEmpty()){p.artwork(logo,false);p.artwork(mark,true);p.y+=25*SCALE;}
            for(int i=0;i<blocks.length();i++){JSONObject b=blocks.getJSONObject(i);String k=b.getString("kind"),t=b.getString("text");if(t.length()>4000)throw new IllegalArgumentException("Receipt field too long");
                if(k.equals("row")||k.equals("total"))p.row(b.getString("label"),t,k.equals("total"));else p.paragraph(t,k);
            }
            p.doc.finishPage(p.page);p.page=null;p.doc.writeTo(out);
        }
    }
    @Override public void close(){if(page!=null)doc.finishPage(page);doc.close();}
}
