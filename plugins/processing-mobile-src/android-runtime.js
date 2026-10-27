/**
 * Java-исходники мини-рантайма Processing, которые попадают в сгенерированный Android-проект.
 * Это собственная реализация API Processing (без Processing for Android): холст, касания,
 * датчики, настройки, разрешения.
 */

export const PAPPLET_JAVA = `package %(package)s;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/**
 * Мини-реализация API Processing поверх android.graphics.Canvas.
 * Рисование идёт в потоке UI, кадры — по requestAnimationFrame.
 */
public class PApplet extends View implements SensorEventListener {

  public static final int CENTER = 3, LEFT = 37, RIGHT = 39, TOP = 101, BOTTOM = 102, BASELINE = 0;
  public static final int CORNER = 0, CORNERS = 1, RADIUS = 2, CLOSE = 2;
  public static final int LEFT_BUTTON = 37, RIGHT_BUTTON = 39, CENTER_BUTTON = 3;

  // Рендереры: эмулятор всегда 2D, но константы нужны для size(w, h, P2D)
  public static final int DEFAULT = 0;
  public static final int P2D = 1;
  public static final int P3D = 2;
  public static final int FX2D = 3;
  public static final int AR = 4;
  public static final int METRO = 5;
  public static final int WEBGL = 2;
  public static final int OPENGL = 2;

  // Ориентация экрана = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_*
  public static final int LANDSCAPE = 0;
  public static final int PORTRAIT = 1;
  public static final int REVERSE_LANDSCAPE = 8;
  public static final int REVERSE_PORTRAIT = 9;
  public static final int UNKNOWN = -1;

  // Коды клавиш
  public static final int CODED = 65535;
  public static final int ENTER = 10;
  public static final int RETURN = 13;
  public static final int BACKSPACE = 8;
  public static final int TAB = 9;
  public static final int ESC = 27;
  public static final int DELETE = 127;
  public static final int UP = 38;
  public static final int DOWN = 40;

  // Наконечники и соединения штриха
  public static final int PROJECT = 0;
  public static final int SQUARE = 1;
  public static final int ROUND = 2;
  public static final int MITER = 0;
  public static final int BEVEL = 3;
  public static final float PI = (float) Math.PI;
  public static final float TWO_PI = PI * 2f, HALF_PI = PI / 2f, QUARTER_PI = PI / 4f;

  public int width = 0, height = 0;
  public int frameCount = 0;
  public float mouseX, mouseY, pmouseX, pmouseY;
  public boolean mousePressed = false;
  public int mouseButton = LEFT_BUTTON;
  public char key = 0;
  public int keyCode = 0;
  public boolean keyPressed = false;
  public final List<MotionEvent> touches = new ArrayList<>();
  public float accelerometerX, accelerometerY, accelerometerZ = 9.81f;
  public float gyroscopeX, gyroscopeY, gyroscopeZ;
  public float magnetometerX, magnetometerY, magnetometerZ;
  public float heading = 0f;
  public float rotation = 0f;
  public String orientation = "portrait";
  public int frameRate = 60;
  public int displayWidth, displayHeight;
  /** Плотность экрана (в Processing for Android — поле, а не метод). */
  public float displayDensity = 1f;

  /** Adaptive UI: скетч в координатах size() масштабируется на весь экран. */
  public static final int ADAPTIVE_CONTAIN = 0;
  public static final int ADAPTIVE_COVER = 1;
  public static final int ADAPTIVE_STRETCH = 2;
  protected boolean adaptiveUi = false;
  protected int adaptiveMode = ADAPTIVE_CONTAIN;
  protected float designWidth = 0, designHeight = 0;
  protected float uiScale = 1f, uiScaleX = 1f, uiScaleY = 1f;
  protected float uiOffsetX = 0, uiOffsetY = 0;
  protected int lastBg = Color.BLACK;

  protected final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  protected final Path path = new Path();
  protected Canvas canvas;
  protected int fillColor = Color.WHITE, strokeColor = Color.BLACK;
  protected boolean doFill = true, doStroke = true;
  protected float strokeWeight = 1f;
  protected int rectMode = CORNER, ellipseMode = CENTER;
  protected float textSize = 12f;
  protected int textAlign = LEFT, textBaseline = BASELINE;
  protected String textFont = "sans-serif";
  protected final Random random = new Random();
  protected long startedAt = System.currentTimeMillis();
  protected long lastFrame = 0;
  protected boolean looping = true;
  protected boolean ready = false;
  protected Activity activity;
  protected SensorManager sensors;
  protected SharedPreferences prefs;
  protected String permissionCallback;
  private final Map<String, Object> memory = new HashMap<>();

  public PApplet(Context context) {
    super(context);
    setFocusable(true);
    setFocusableInTouchMode(true);
    paint.setStyle(Paint.Style.FILL);
  }

  // ── жизненный цикл ────────────────────────────────────────────────────────────────

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    Context ctx = getContext();
    activity = (ctx instanceof Activity) ? (Activity) ctx : null;
    prefs = ctx.getSharedPreferences("processing", Context.MODE_PRIVATE);
    displayWidth = getResources().getDisplayMetrics().widthPixels;
    displayHeight = getResources().getDisplayMetrics().heightPixels;
    displayDensity = getResources().getDisplayMetrics().density;
    sensors = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
    startSensors();
    try {
      setup();
    } catch (Exception e) {
      Log.e("Processing", "setup() failed", e);
    }
    ready = true;
    postInvalidateOnAnimation();
  }

  @Override
  protected void onDetachedFromWindow() {
    stopSensors();
    super.onDetachedFromWindow();
  }

  public void setup() { }
  public void draw() { }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    this.canvas = canvas;
    if (!ready) return;
    long now = System.currentTimeMillis();
    if (lastFrame != 0) {
      long dt = now - lastFrame;
      if (dt > 1000 / Math.max(1, frameRate)) { /* держим темп */ }
    }
    lastFrame = now;
    try {
      if (adaptiveUi) {
        computeAdaptiveTransform();
        canvas.drawColor(lastBg);
        canvas.save();
        canvas.translate(uiOffsetX, uiOffsetY);
        canvas.scale(uiScaleX, uiScaleY);
      }
      draw();
      if (adaptiveUi) canvas.restore();
    } catch (Exception e) {
      Log.e("Processing", "draw() failed", e);
      looping = false;
    }
    frameCount++;
    if (looping) postInvalidateOnAnimation();
  }

  public void loop() { looping = true; postInvalidateOnAnimation(); }
  public void noLoop() { looping = false; }
  public void redraw() { invalidate(); }
  public void exit() { looping = false; }

  // ── размер и координаты ───────────────────────────────────────────────────────────

  public void size(int w, int h) {
    designWidth = w;
    designHeight = h;
    width = w;
    height = h;
    computeAdaptiveTransform();
  }

  /** Рендерер в Processing for Android игнорируется: рисуем 2D. */
  public void size(int w, int h, int renderer) {
    size(w, h);
    if (renderer != P2D && renderer != FX2D) {
      Log.w("Processing", "Рендерер " + renderer + " не поддерживается, используется 2D");
    }
  }

  public void fullScreen() {
    width = displayWidth;
    height = displayHeight;
    designWidth = width;
    designHeight = height;
    computeAdaptiveTransform();
  }

  public void fullScreen(int renderer) { fullScreen(); }

  @Override
  protected void onSizeChanged(int w, int h, int oldw, int oldh) {
    super.onSizeChanged(w, h, oldw, oldh);
    displayWidth = w;
    displayHeight = h;
    computeAdaptiveTransform();
  }

  public void enableAdaptiveUI() { enableAdaptiveUI(ADAPTIVE_CONTAIN); }

  public void enableAdaptiveUI(int mode) {
    adaptiveUi = true;
    adaptiveMode = mode;
    computeAdaptiveTransform();
    invalidate();
  }

  public void disableAdaptiveUI() {
    adaptiveUi = false;
    uiScale = uiScaleX = uiScaleY = 1f;
    uiOffsetX = uiOffsetY = 0;
    invalidate();
  }

  public boolean isAdaptiveUI() { return adaptiveUi; }
  public float uiScale() { return uiScale; }
  public float uiOffsetX() { return uiOffsetX; }
  public float uiOffsetY() { return uiOffsetY; }

  public float toDesignX(float screenX) { return (screenX - uiOffsetX) / (uiScaleX == 0 ? 1f : uiScaleX); }
  public float toDesignY(float screenY) { return (screenY - uiOffsetY) / (uiScaleY == 0 ? 1f : uiScaleY); }
  public float toScreenX(float designX) { return designX * uiScaleX + uiOffsetX; }
  public float toScreenY(float designY) { return designY * uiScaleY + uiOffsetY; }

  protected void computeAdaptiveTransform() {
    float vw = getWidth();
    float vh = getHeight();
    if (vw <= 0 || vh <= 0) return;
    float dw = designWidth > 0 ? designWidth : (width > 0 ? width : vw);
    float dh = designHeight > 0 ? designHeight : (height > 0 ? height : vh);
    if (dw <= 0 || dh <= 0) return;
    if (adaptiveMode == ADAPTIVE_STRETCH) {
      uiScaleX = vw / dw;
      uiScaleY = vh / dh;
      uiScale = Math.min(uiScaleX, uiScaleY);
      uiOffsetX = 0;
      uiOffsetY = 0;
    } else if (adaptiveMode == ADAPTIVE_COVER) {
      uiScale = Math.max(vw / dw, vh / dh);
      uiScaleX = uiScaleY = uiScale;
      uiOffsetX = (vw - dw * uiScale) / 2f;
      uiOffsetY = (vh - dh * uiScale) / 2f;
    } else {
      uiScale = Math.min(vw / dw, vh / dh);
      uiScaleX = uiScaleY = uiScale;
      uiOffsetX = (vw - dw * uiScale) / 2f;
      uiOffsetY = (vh - dh * uiScale) / 2f;
    }
  }

  public int frameRateValue() { return frameRate; }
  public void frameRate(int fps) { frameRate = Math.max(1, fps); }
  public long millis() { return System.currentTimeMillis() - startedAt; }

  // ── цвет и стиль ──────────────────────────────────────────────────────────────────

  public void background(int rgb) { background(rgb, rgb, rgb); }

  public void background(int r, int g, int b) {
    lastBg = Color.rgb(r, g, b);
    doFill = true;
    fill(r, g, b);
    canvasRect(0, 0, width, height);
    doFill = true;
  }

  public void fill(int rgb) { fill(rgb, rgb, rgb); }
  public void fill(int r, int g, int b) { fillColor = Color.rgb(r, g, b); doFill = true; }
  public void noFill() { doFill = false; }
  public void stroke(int rgb) { stroke(rgb, rgb, rgb); }
  public void stroke(int r, int g, int b) { strokeColor = Color.rgb(r, g, b); doStroke = true; }
  public void noStroke() { doStroke = false; }
  public void strokeWeight(float w) { strokeWeight = w; }
  public void rectMode(int m) { rectMode = m; }
  public void ellipseMode(int m) { ellipseMode = m; }
  public void smooth() { paint.setAntiAlias(true); }
  public void noSmooth() { paint.setAntiAlias(false); }
  public void strokeCap(int cap) {
    if (cap == PROJECT) paint.setStrokeCap(Paint.Cap.BUTT);
    else if (cap == SQUARE) paint.setStrokeCap(Paint.Cap.SQUARE);
    else paint.setStrokeCap(Paint.Cap.ROUND);
  }

  public void strokeJoin(int join) {
    if (join == MITER) paint.setStrokeJoin(Paint.Join.MITER);
    else if (join == BEVEL) paint.setStrokeJoin(Paint.Join.BEVEL);
    else paint.setStrokeJoin(Paint.Join.ROUND);
  }

  // ── фигуры ────────────────────────────────────────────────────────────────────────

  private void canvasRect(float x, float y, float w, float h) {
    paint.setColor(fillColor);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawRect(x, y, x + w, y + h, paint);
  }

  public void rect(float x, float y, float w, float h) {
    if (rectMode == CORNERS) { float x2 = Math.min(x, x + w), y2 = Math.min(y, y + h); w = Math.abs(w); h = Math.abs(h); x = x2; y = y2; }
    else if (rectMode == CENTER) { x -= w / 2f; y -= h / 2f; }
    else if (rectMode == RADIUS) { x -= w / 2f; y -= h / 2f; }
    if (doFill) canvasRect(x, y, w, h);
    if (doStroke) {
      paint.setColor(strokeColor);
      paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(strokeWeight);
      canvas.drawRect(x, y, x + w, y + h, paint);
    }
  }

  public void rect(float x, float y, float w, float h, float r) {
    android.graphics.RectF box = new android.graphics.RectF(x, y, x + w, y + h);
    if (doFill) { paint.setColor(fillColor); paint.setStyle(Paint.Style.FILL); canvas.drawRoundRect(box, r, r, paint); }
    if (doStroke) {
      paint.setColor(strokeColor);
      paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(strokeWeight);
      canvas.drawRoundRect(box, r, r, paint);
    }
  }

  private boolean shapeStarted = false;
  public void beginShape() { path.reset(); shapeStarted = false; }
  public void vertex(float x, float y) {
    if (!shapeStarted) { path.moveTo(x, y); shapeStarted = true; }
    else path.lineTo(x, y);
  }
  public void endShape() { drawPath(); }
  public void endShape(int mode) { if (mode == CLOSE) path.close(); endShape(); }

  public void square(float x, float y, float s) { rect(x, y, s, s); }

  public void ellipse(float x, float y, float w, float h) {
    float rx, ry;
    if (ellipseMode == CORNERS) { rx = Math.abs(w) / 2f; ry = Math.abs(h) / 2f; x = (x + x + w) / 2f; y = (y + y + h) / 2f; }
    else if (ellipseMode == RADIUS) { rx = Math.abs(w); ry = Math.abs(h); }
    else { rx = Math.abs(w) / 2f; ry = Math.abs(h) / 2f; }
    if (doFill) { paint.setColor(fillColor); paint.setStyle(Paint.Style.FILL); canvas.drawOval(x - rx, y - ry, x + rx, y + ry, paint); }
    if (doStroke) { paint.setColor(strokeColor); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(strokeWeight); canvas.drawOval(x - rx, y - ry, x + rx, y + ry, paint); }
  }

  public void circle(float x, float y, float d) { ellipse(x, y, d, d); }

  public void line(float x1, float y1, float x2, float y2) {
    paint.setColor(strokeColor);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(strokeWeight);
    canvas.drawLine(x1, y1, x2, y2, paint);
  }

  public void point(float x, float y) {
    paint.setColor(strokeColor);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawCircle(x, y, Math.max(0.5f, strokeWeight / 2f), paint);
  }

  public void triangle(float x1, float y1, float x2, float y2, float x3, float y3) {
    path.reset(); path.moveTo(x1, y1); path.lineTo(x2, y2); path.lineTo(x3, y3); path.close();
    drawPath();
  }

  public void quad(float x1, float y1, float x2, float y2, float x3, float y3, float x4, float y4) {
    path.reset(); path.moveTo(x1, y1); path.lineTo(x2, y2); path.lineTo(x3, y3); path.lineTo(x4, y4); path.close();
    drawPath();
  }

  public void arc(float x, float y, float w, float h, float start, float stop) {
    paint.setColor(fillColor);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawArc(x - w / 2f, y - h / 2f, x + w / 2f, y + h / 2f, (int) Math.toDegrees(start), (int) Math.toDegrees(stop - start), true, paint);
  }

  private void drawPath() {
    if (doFill) { paint.setColor(fillColor); paint.setStyle(Paint.Style.FILL); canvas.drawPath(path, paint); }
    if (doStroke) { paint.setColor(strokeColor); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(strokeWeight); canvas.drawPath(path, paint); }
  }

  // ── текст ─────────────────────────────────────────────────────────────────────────

  public void textSize(float s) { textSize = s; }
  public void textAlign(int h) { textAlign = h; }
  public void textAlign(int h, int v) { textAlign = h; textBaseline = v; }
  public void textFont(String name) { textFont = name; }

  public void text(String s, float x, float y) {
    paint.setTextSize(textSize);
    paint.setTypeface(Typeface.create(textFont, Typeface.NORMAL));
    paint.setTextAlign(textAlign == CENTER ? Paint.Align.CENTER : textAlign == RIGHT ? Paint.Align.RIGHT : Paint.Align.LEFT);
    if (doFill) { paint.setColor(fillColor); paint.setStyle(Paint.Style.FILL); canvas.drawText(s, x, y, paint); }
    if (doStroke) { paint.setColor(strokeColor); paint.setStyle(Paint.Style.STROKE); canvas.drawText(s, x, y, paint); }
  }

  public float textWidth(String s) {
    paint.setTextSize(textSize);
    return paint.measureText(s);
  }

  // ── матрицы ───────────────────────────────────────────────────────────────────────

  public void pushMatrix() { canvas.save(); }
  public void popMatrix() { canvas.restore(); }
  public void translate(float x, float y) { canvas.translate(x, y); }
  public void rotate(float a) { canvas.rotate((float) Math.toDegrees(a)); }
  public void scale(float x) { canvas.scale(x, x); }
  public void scale(float x, float y) { canvas.scale(x, y); }
  public void resetMatrix() { canvas.restore(); canvas.save(); }

  // ── математика ────────────────────────────────────────────────────────────────────

  public float map(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
  public float constrain(float v, float lo, float hi) { return Math.max(lo, Math.min(hi, v)); }
  public float abs(float v) { return Math.abs(v); }
  public int abs(int v) { return Math.abs(v); }
  public float sqrt(float v) { return (float) Math.sqrt(v); }
  public float sin(float v) { return (float) Math.sin(v); }
  public float cos(float v) { return (float) Math.cos(v); }
  public float tan(float v) { return (float) Math.tan(v); }
  public float atan2(float y, float x) { return (float) Math.atan2(y, x); }
  public float min(float a, float b) { return Math.min(a, b); }
  public float max(float a, float b) { return Math.max(a, b); }
  public int min(int a, int b) { return Math.min(a, b); }
  public int max(int a, int b) { return Math.max(a, b); }
  public float dist(float x1, float y1, float x2, float y2) { return (float) Math.hypot(x2 - x1, y2 - y1); }
  public float norm(float v, float a, float b) { return map(v, a, b, 0, 1); }
  public float lerp(float a, float b, float t) { return a + (b - a) * t; }
  public float radians(float d) { return (float) Math.toRadians(d); }
  public float degrees(float r) { return (float) Math.toDegrees(r); }
  public float sq(float v) { return v * v; }
  public float mag(float x, float y) { return (float) Math.hypot(x, y); }
  public float random() { return random.nextFloat(); }
  public float random(float a) { return a * random.nextFloat(); }
  public float random(float a, float b) { return a + random.nextFloat() * (b - a); }
  public void randomSeed(long seed) { random.setSeed(seed); }
  public float noise(float x) { return (float) (0.5 + 0.5 * Math.sin(x * 1.7)); }
  public void noiseSeed(long seed) { }

  // ── ввод ──────────────────────────────────────────────────────────────────────────

  @Override
  public boolean onTouchEvent(MotionEvent event) {
    int action = event.getActionMasked();
    int index = event.getActionIndex();
    float x = event.getX(index), y = event.getY(index);
    if (adaptiveUi) {
      x = toDesignX(x);
      y = toDesignY(y);
    }
    switch (action) {
      case MotionEvent.ACTION_DOWN:
      case MotionEvent.ACTION_POINTER_DOWN: {
        pmouseX = mouseX; pmouseY = mouseY;
        mouseX = x; mouseY = y;
        mousePressed = true;
        mouseButton = LEFT_BUTTON;
        touches.add(event);
        mousePressed();
        touchStarted();
        invalidate();
        return true;
      }
      case MotionEvent.ACTION_MOVE: {
        pmouseX = mouseX; pmouseY = mouseY;
        mouseX = x; mouseY = y;
        mouseDragged();
        touchMoved();
        invalidate();
        return true;
      }
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_POINTER_UP:
      case MotionEvent.ACTION_CANCEL: {
        mouseX = x; mouseY = y;
        mousePressed = false;
        touches.remove(event);
        mouseReleased();
        touchEnded();
        invalidate();
        return true;
      }
    }
    return super.onTouchEvent(event);
  }

  @Override
  public boolean onKeyDown(int code, KeyEvent event) {
    keyCode = code;
    key = (char) event.getUnicodeChar();
    keyPressed = true;
    keyPressed();
    invalidate();
    return true;
  }

  @Override
  public boolean onKeyUp(int code, KeyEvent event) {
    keyPressed = false;
    keyReleased();
    invalidate();
    return true;
  }

  public void mousePressed() { }
  public void mouseReleased() { }
  public void mouseDragged() { }
  public void mouseMoved() { }
  public void keyPressed() { }
  public void keyReleased() { }
  public void touchStarted() { }
  public void touchMoved() { }
  public void touchEnded() { }
  public void onPermissionGranted(String permission, boolean granted) {
    if (permissionCallback == null) return;
    try {
      java.lang.reflect.Method m = PApplet.class.getDeclaredMethod(permissionCallback, boolean.class);
      m.invoke(this, granted);
    } catch (Exception e) {
      Log.e("Processing", "permission callback failed", e);
    }
  }

  // ── датчики ───────────────────────────────────────────────────────────────────────

  private void startSensors() {
    if (sensors == null) return;
    sensors.registerListener(this, sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER), SensorManager.SENSOR_DELAY_GAME);
    sensors.registerListener(this, sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE), SensorManager.SENSOR_DELAY_GAME);
    sensors.registerListener(this, sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD), SensorManager.SENSOR_DELAY_GAME);
  }

  private void stopSensors() {
    if (sensors != null) sensors.unregisterListener(this);
  }

  @Override
  public void onSensorChanged(SensorEvent event) {
    if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
      accelerometerX = event.values[0];
      accelerometerY = event.values[1];
      accelerometerZ = event.values[2];
    } else if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
      gyroscopeX = event.values[0];
      gyroscopeY = event.values[1];
      gyroscopeZ = event.values[2];
    } else if (event.sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) {
      magnetometerX = event.values[0];
      magnetometerY = event.values[1];
      magnetometerZ = event.values[2];
      heading = (float) Math.toDegrees(Math.atan2(magnetometerY, magnetometerX));
    }
  }

  @Override
  public void onAccuracyChanged(Sensor sensor, int accuracy) { }

  // ── Android: активность, настройки, разрешения ───────────────────────────────────

  public Activity getActivity() { return activity; }
  public SharedPreferences getPreferences() { return prefs; }
  public SensorManager getSensorManager() { return sensors; }
  public String getPackageName() { return super.getContext().getPackageName(); }

  /** Ориентация фиксируется в manifest; здесь — только чтение. */
  public void orientation(int mode) {
    if (activity == null) return;
    activity.setRequestedOrientation(mode);
  }

  /** Экранная клавиатура. */
  public void openKeyboard() { }
  public void closeKeyboard() { }

  /** Кнопка «Назад»: по умолчанию выходим, скетч может переопределить. */
  public void backPressed() { if (activity != null) activity.finish(); }

  /** Фоновый поток для сети, диска и тяжёлых вычислений. */
  public void thread(final String name) {
    new Thread(new Runnable() {
      public void run() {
        try {
          java.lang.reflect.Method m = PApplet.class.getDeclaredMethod(name);
          m.invoke(PApplet.this);
        } catch (Exception e) {
          Log.e("Processing", "thread(" + name + ") failed", e);
        }
      }
    }).start();
  }

  public String nf(float value, int left, int right) {
    return String.format(Locale.US, "%." + right + "f", value);
  }

  public String nf(int value, int left, int right) {
    return nf((float) value, left, right);
  }

  public PFont createFont(String name, float size) {
    return null; // используется системный шрифт
  }

  /** Запрос runtime-разрешения. Второй аргумент — имя метода-обработчика(boolean). */
  public void requestPermission(String permission, String callback) {
    permissionCallback = callback;
    if (activity == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      activity.requestPermissions(new String[]{permission}, permission.hashCode());
    } else {
      onPermissionGranted(permission, true);
    }
  }

  public void requestPermission(String permission) {
    requestPermission(permission, null);
  }

  public boolean hasPermission(String permission) {
    if (activity == null) return false;
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
    return activity.checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED;
  }

  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    if (permissions == null || permissions.length == 0) return;
    boolean granted = grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
    onPermissionGranted(permissions[0], granted);
  }

  public JSONObject loadJSONObject(String filename) {
    String[] names = { filename, "data/" + filename };
    for (int i = 0; i < names.length; i++) {
      try {
        java.io.InputStream in = getContext().getAssets().open(names[i]);
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        return new JSONObject(buf.toString("UTF-8"));
      } catch (Exception ignored) { }
    }
    Log.w("Processing", "loadJSONObject: не найден " + filename);
    return null;
  }

  public void println(Object o) { Log.d("Processing", String.valueOf(o)); }
  public void print(Object o) { Log.d("Processing", String.valueOf(o)); }

  /** Значения, сохранённые между запусками (аналог SharedPreferences). */
  public void put(String key, Object value) { memory.put(key, value); }

  public Object get(String key) { return memory.get(key); }
}
`;

export const PVECTOR_JAVA = `package %(package)s;

/** Вектор — как в Processing. */
public class PVector {
  public float x, y, z;

  public PVector() { }
  public PVector(float x, float y) { this.x = x; this.y = y; }
  public PVector(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }

  public PVector set(float x, float y) { this.x = x; this.y = y; this.z = 0; return this; }
  public PVector set(float x, float y, float z) { this.x = x; this.y = y; this.z = z; return this; }
  public PVector set(PVector v) { return set(v.x, v.y, v.z); }

  public PVector add(float x, float y) { this.x += x; this.y += y; return this; }
  public PVector add(float x, float y, float z) { this.x += x; this.y += y; this.z += z; return this; }
  public PVector add(PVector v) { return add(v.x, v.y, v.z); }
  public PVector sub(float x, float y) { this.x -= x; this.y -= y; return this; }
  public PVector sub(float x, float y, float z) { this.x -= x; this.y -= y; this.z -= z; return this; }
  public PVector sub(PVector v) { return sub(v.x, v.y, v.z); }
  public PVector mult(float f) { x *= f; y *= f; z *= f; return this; }
  public PVector mult(float fx, float fy) { x *= fx; y *= fy; return this; }
  public PVector mult(PVector v) { x *= v.x; y *= v.y; z *= v.z; return this; }
  public PVector div(float f) { x /= f; y /= f; z /= f; return this; }
  public PVector div(float fx, float fy) { x /= fx; y /= fy; return this; }

  public float mag() { return (float) Math.sqrt(x * x + y * y + z * z); }
  public float magSq() { return x * x + y * y + z * z; }
  public PVector normalize() { float m = mag(); if (m > 0) { x /= m; y /= m; z /= m; } return this; }
  public PVector limit(float max) { if (magSq() > max * max) normalize().mult(max); return this; }
  public PVector setMag(float len) { return normalize().mult(len); }
  public float heading() { return (float) Math.atan2(y, x); }
  public float dist(PVector v) { return (float) Math.hypot(x - v.x, y - v.y); }
  public PVector lerp(PVector v, float amt) { x += (v.x - x) * amt; y += (v.y - y) * amt; z += (v.z - z) * amt; return this; }
  public PVector copy() { return new PVector(x, y, z); }
  public float[] array() { return new float[]{x, y, z}; }

  public static PVector fromAngle(float angle) { return fromAngle(angle, 1); }
  public static PVector fromAngle(float angle, float len) { return new PVector((float) Math.cos(angle) * len, (float) Math.sin(angle) * len, 0); }
  public static PVector random2D() { return fromAngle((float) (Math.random() * Math.PI * 2)); }
  public static PVector add(PVector a, PVector b) { return a.copy().add(b); }
  public static PVector sub(PVector a, PVector b) { return a.copy().sub(b); }
  public static PVector mult(PVector v, float s) { return v.copy().mult(s); }
  public static float dist(PVector a, PVector b) { return a.dist(b); }
  public static PVector lerp(PVector a, PVector b, float amt) { return a.copy().lerp(b, amt); }
}
`;

export const JSONOBJECT_JAVA = `package %(package)s;

/** JSONObject как в Processing: hasKey / getFloat поверх org.json. */
public class JSONObject {
  private final org.json.JSONObject raw;

  public JSONObject() { raw = new org.json.JSONObject(); }
  public JSONObject(String source) throws org.json.JSONException { raw = new org.json.JSONObject(source); }
  JSONObject(org.json.JSONObject raw) { this.raw = raw; }

  public boolean hasKey(String key) { return raw.has(key); }
  public boolean has(String key) { return raw.has(key); }
  public String getString(String key) { return raw.optString(key, ""); }
  public float getFloat(String key) { return (float) raw.optDouble(key, 0); }
  public int getInt(String key) { return raw.optInt(key, 0); }
  public boolean getBoolean(String key) { return raw.optBoolean(key, false); }
  public JSONObject getJSONObject(String key) {
    org.json.JSONObject child = raw.optJSONObject(key);
    return child == null ? null : new JSONObject(child);
  }
}
`;

export const PFONT_JAVA = `package %(package)s;

/** Минимальный шрифт: используется системный шрифт Android. */
public class PFont {
  public String name;
  public float size;

  public PFont(String name, float size) {
    this.name = name;
    this.size = size;
  }

  public String getName() { return name; }
  public float getSize() { return size; }
}
`;

export const ADAPTIVE_UI_JAVA = `package %(package)s;

/**
 * AdaptiveUI — библиотека, которая делает любой UI адаптивным.
 *
 * Скетч пишется в координатах size() (например size(390, 844)).
 * На реальном телефоне рисование, текст, обводки и касания
 * автоматически масштабируются под экран. Менять скетч не нужно:
 * достаточно AdaptiveUI.attach(this) — Processing Studio вызывает его сама,
 * если при создании проекта включена галочка «Adaptive UI».
 *
 * Режимы:
 *   CONTAIN  — вписать целиком, поля по краям (по умолчанию)
 *   COVER    — заполнить экран, лишнее обрезается
 *   STRETCH  — растянуть по ширине и высоте независимо
 *
 * Примеры:
 *   AdaptiveUI.attach(this);
 *   AdaptiveUI.attach(this, AdaptiveUI.COVER);
 *   float s = AdaptiveUI.scale(this);
 */
public class AdaptiveUI {

  public static final int CONTAIN = PApplet.ADAPTIVE_CONTAIN;
  public static final int COVER = PApplet.ADAPTIVE_COVER;
  public static final int STRETCH = PApplet.ADAPTIVE_STRETCH;

  private AdaptiveUI() { }

  /** Включает адаптивный UI для любого скетча. */
  public static void attach(PApplet app) {
    attach(app, CONTAIN);
  }

  public static void attach(PApplet app, int mode) {
    if (app != null) app.enableAdaptiveUI(mode);
  }

  public static void detach(PApplet app) {
    if (app != null) app.disableAdaptiveUI();
  }

  public static boolean enabled(PApplet app) {
    return app != null && app.isAdaptiveUI();
  }

  /** Текущий масштаб (при STRETCH — меньшая из осей). */
  public static float scale(PApplet app) {
    return app == null ? 1f : app.uiScale();
  }

  /** Экранная X из координаты скетча. */
  public static float screenX(PApplet app, float x) {
    return app == null ? x : app.toScreenX(x);
  }

  /** Экранная Y из координаты скетча. */
  public static float screenY(PApplet app, float y) {
    return app == null ? y : app.toScreenY(y);
  }

  /** Координата скетча из экранной X (касание уже пересчитано автоматически). */
  public static float designX(PApplet app, float x) {
    return app == null ? x : app.toDesignX(x);
  }

  public static float designY(PApplet app, float y) {
    return app == null ? y : app.toDesignY(y);
  }

  /** Масштабирует значение (размер кнопки, отступ, радиус) пропорционально экрану. */
  public static float s(PApplet app, float value) {
    return value * scale(app);
  }
}
`;
