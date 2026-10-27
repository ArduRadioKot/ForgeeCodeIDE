// ==FrogeePlugin==
// @name        Processing Mobile
// @version     1.0.0
// @description Эмулятор Processing, экспорт и сборка Android
// @author      FrogeeSoft
// ==/FrogeePlugin==
// Processing Studio components: Copyright FrogeeSoft, GPL-2.0.
// Source: https://github.com/ArduRadioKot/Processing-Studio

// ── android-runtime (Processing Studio) ──
/**
 * Java-исходники мини-рантайма Processing, которые попадают в сгенерированный Android-проект.
 * Это собственная реализация API Processing (без Processing for Android): холст, касания,
 * датчики, настройки, разрешения.
 */

const PAPPLET_JAVA = `package %(package)s;

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

const PVECTOR_JAVA = `package %(package)s;

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

const JSONOBJECT_JAVA = `package %(package)s;

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

const PFONT_JAVA = `package %(package)s;

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

const ADAPTIVE_UI_JAVA = `package %(package)s;

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


// ── android-project (Processing Studio) ──
/**
 * Проект Processing Studio: настройки приложения и экспорт в Android-проект (Gradle).
 *
 * Скетч (.pde) — это Java, поэтому экспорт не требует Processing for Android:
 * исходник становится подклассом собственного PApplet, а в проект попадает
 * мини-рантайм с рисованием, касаниями, датчиками и разрешениями.
 */


const PROJECT_FILE = 'processing-studio.json';

const PERMISSIONS = [
  { id: 'INTERNET', label: 'Интернет' },
  { id: 'ACCESS_NETWORK_STATE', label: 'Состояние сети' },
  { id: 'CAMERA', label: 'Камера' },
  { id: 'RECORD_AUDIO', label: 'Микрофон' },
  { id: 'ACCESS_FINE_LOCATION', label: 'Точное местоположение' },
  { id: 'ACCESS_COARSE_LOCATION', label: 'Приблизительное местоположение' },
  { id: 'READ_EXTERNAL_STORAGE', label: 'Чтение файлов' },
  { id: 'WRITE_EXTERNAL_STORAGE', label: 'Запись файлов' },
  { id: 'READ_PHONE_STATE', label: 'Состояние телефона' },
  { id: 'VIBRATE', label: 'Вибрация' },
  { id: 'BLUETOOTH', label: 'Bluetooth' },
  { id: 'NFC', label: 'NFC' },
  { id: 'USE_SIP', label: 'SIP-вызовы' },
];

const ORIENTATIONS = [
  { id: 'unspecified', label: 'Не задана' },
  { id: 'portrait', label: 'Портрет' },
  { id: 'landscape', label: 'Альбом' },
  { id: 'sensor', label: 'Как в системе' },
];

const DEFAULT_SETTINGS = {
  name: 'Sketch',
  packageName: 'com.example.sketch',
  minSdk: 24,
  targetSdk: 34,
  orientation: 'unspecified',
  permissions: ['INTERNET'],
  theme: 'dark',
  sketch: 'sketch.pde',
  adaptiveUi: true,
};

function defaultSettingsFor(sketchName = 'sketch.pde') {
  const base = String(sketchName || 'sketch').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, ' ') || 'Sketch';
  const title = base.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Sketch';
  const pkg = 'com.example.' + base.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { ...DEFAULT_SETTINGS, name: title, packageName: pkg, sketch: sketchName };
}

function sanitizePackageName(name) {
  const parts = String(name || '').split('.').map((p) => p.replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean);
  return parts.length ? parts.join('.') : 'com.example.sketch';
}

function isValidPackageName(name) {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(String(name || ''));
}

function javaClassName(name) {
  const parts = String(name || 'Sketch').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[A-Za-z_]/.test(out) ? out : 'Sketch';
}

// ── чтение и запись настроек ──────────────────────────────────────────────────────────

async function loadProject(root) {
  if (!root) return null;
  try {
    const res = await window.electronAPI?.getFileContent?.(joinPath(root, PROJECT_FILE));
    if (!res?.success || !res.content) return null;
    const data = JSON.parse(res.content);
    return { ...DEFAULT_SETTINGS, ...data };
  } catch (err) {
    return null;
  }
}

async function saveProject(root, settings) {
  if (!root) return false;
  try {
    const res = await window.electronAPI?.writeFile?.(joinPath(root, PROJECT_FILE), JSON.stringify(settings, null, 2));
    return !!(res && res.success);
  } catch (err) {
    return false;
  }
}

function joinPath(a, b) {
  const left = String(a || '').replace(/[\\/]+$/, '');
  return `${left}/${b}`;
}

// ── скетч → класс Java ────────────────────────────────────────────────────────────────

const OVERRIDABLE = [
  'setup', 'draw', 'mousePressed', 'mouseReleased', 'mouseDragged', 'mouseMoved',
  'keyPressed', 'keyReleased', 'touchStarted', 'touchMoved', 'touchEnded',
  'onSensorChanged', 'onPermissionGranted',
];

const METHOD_RE = /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*([A-Za-z_][\w<>\[\],.]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
const FIELD_RE = /^\s*(?:(?:public|private|protected|static|final|volatile|transient)\s+)*([A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;\s*$/;
const STATEMENT_WORDS = /^(?:return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|new|println|print)\b/;

/** Processing считает 0.14 литералом float; javac — double. */
function javaifyFloats(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inBlock) {
      out += ch;
      if (ch === '*' && next === '/') { out += '/'; i++; inBlock = false; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[++i] || ''; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += text[i]; i++; }
      if (i < text.length) out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      out += '/*';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const rest = text.slice(i);
      const match = rest.match(/^(\d+\.\d+)(?![eEfF\d])/);
      if (match) {
        out += match[1] + 'f';
        i += match[1].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Разбирает .pde: верхнеуровневые объявления становятся полями класса,
 * верхнеуровневые операторы — началом setup(), методы — методами класса.
 */
function sketchText(source) {
  if (Array.isArray(source)) return source.map((s) => s?.code || '').join('\n');
  return String(source || '');
}

function sketchMentionsAdaptive(source) {
  return /\bAdaptiveUI\s*\./.test(sketchText(source));
}

function hasAdaptiveAttach(source) {
  return /\bAdaptiveUI\s*\.\s*attach\s*\(/.test(sketchText(source));
}

function sketchToJava(source, className = 'Sketch', pkg = '', opts = {}) {
  const sources = Array.isArray(source)
    ? source.map((s) => ({ name: s.name || 'sketch.pde', code: s.code || '' }))
    : [{ name: 'sketch.pde', code: String(source || '') }];
  const fields = [];
  const setupPrelude = [];
  const methods = [];
  const classes = [];
  const imports = new Set([
    'import java.util.ArrayList;',
    'import java.util.HashMap;',
    'import java.util.List;',
    'import android.content.Context;',
  ]);

  // Все вкладки .pde склеиваются в один класс — как в preprocessor Processing.
  sources.forEach((file, fileIndex) => {
    const parsed = parseSketchFile(file.code, fileIndex === 0);
    parsed.imports.forEach((imp) => {
      // AdaptiveUI лежит в том же пакете, что и скетч — `import AdaptiveUI;` в Java невалиден.
      if (/^import\s+(?:[\w.]+\.)?AdaptiveUI\s*;$/.test(imp)) return;
      imports.add(imp);
    });
    fields.push(...parsed.fields);
    setupPrelude.push(...parsed.prelude);
    methods.push(...parsed.methods);
    classes.push(...parsed.classes);
  });

  const setup = methods.find((m) => m.name === 'setup');
  const draw = methods.find((m) => m.name === 'draw');
  const others = methods.filter((m) => m !== setup && m !== draw);

  const out = [];
  if (pkg) {
    out.push(`package ${pkg};`);
    out.push('');
  }
  for (const imp of imports) out.push(imp);
  out.push('');
  out.push(`public class ${className} extends PApplet {`);
  out.push('');
  out.push(`  public ${className}(Context context) { super(context); }`);
  out.push('');
  for (const field of fields) out.push(`  ${field}`);
  if (fields.length) out.push('');

  out.push('  @Override');
  out.push('  public void setup() {');
  for (const line of setupPrelude) out.push(line ? `  ${line}` : '');
  for (const line of (setup?.body || [])) out.push(`  ${line}`);
  if (opts.adaptiveUi && !hasAdaptiveAttach(source)) {
    out.push('    AdaptiveUI.attach(this);');
  }
  out.push('  }');
  out.push('');

  out.push('  @Override');
  out.push('  public void draw() {');
  for (const line of (draw?.body || [])) out.push(`  ${line}`);
  out.push('  }');

  for (const method of others) {
    out.push('');
    if (OVERRIDABLE.includes(method.name)) out.push('  @Override');
    out.push(`  public ${method.returnType} ${method.name}(${method.params.replace(/\bfinal\s+/g, '')}) {`);
    for (const line of method.body) out.push(`  ${line}`);
    out.push('  }');
  }

  // Вложенные классы: в Java у вложенного класса не может быть public.
  for (const cls of classes) {
    out.push('');
    const header = cls.header.trim().replace(/^(?:public|private|protected)\s+/, '').replace(/^static\s+/, '');
    out.push(`  ${header}`);
    for (const line of cls.body) out.push(line ? `  ${line}` : '');
    out.push('  }');
  }
  out.push('}');
  return javaifyFloats(out.join('\n'));
}

/** Разбирает один .pde: поля, операторы, методы и вложенные классы. */
function parseSketchFile(source, isMain) {
  const lines = String(source || '').split('\n');
  const fields = [];
  const prelude = [];
  const methods = [];
  const classes = [];
  const imports = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
      || trimmed.startsWith('package ')) {
      i++;
      continue;
    }

    if (trimmed.startsWith('import ')) {
      imports.push(trimmed.replace(/;?\s*$/, '') + ';');
      i++;
      continue;
    }

    // Внутренний класс sketch становится вложенным классом приложения.
    const classDecl = trimmed.match(/^(?:(?:public|private|protected|static|final|abstract)\s+)*class\s+([A-Za-z_]\w*)/);
    if (classDecl) {
      const body = [];
      let depth = countBraces(line);
      let started = line.includes('{');
      let j = i + 1;
      for (; j < lines.length; j++) {
        const current = lines[j];
        const nextDepth = depth + countBraces(current);
        if (started && nextDepth <= 0) break;
        body.push(current);
        depth = nextDepth;
        if (!started && current.includes('{')) started = true;
      }
      classes.push({ name: classDecl[1], header: line, body });
      i = j + 1;
      continue;
    }

    const decl = trimmed.match(METHOD_RE);
    if (decl && !trimmed.endsWith(';') && !STATEMENT_WORDS.test(trimmed)) {
      const open = trimmed.indexOf('{');
      const close = trimmed.lastIndexOf('}');
      if (open >= 0 && close > open) {
        // Метод целиком в одной строке: void setup() { size(100, 100); }
        methods.push({
          returnType: decl[1].trim(),
          name: decl[2],
          params: decl[3].trim(),
          body: [trimmed.slice(open + 1, close).trim()],
        });
        i++;
        continue;
      }
      // Метод в несколько строк: собираем тело до закрывающей скобки.
      const body = [];
      let depth = countBraces(line);
      let started = line.includes('{');
      let j = i + 1;
      for (; j < lines.length; j++) {
        const current = lines[j];
        const nextDepth = depth + countBraces(current);
        if (started && nextDepth <= 0) break; // закрывающая скобка — её ставим сами
        body.push(current);
        depth = nextDepth;
        if (!started && current.includes('{')) started = true;
      }
      methods.push({ returnType: decl[1].trim(), name: decl[2], params: decl[3].trim(), body });
      i = j + 1;
      continue;
    }

    const field = trimmed.match(FIELD_RE);
    if (field && !STATEMENT_WORDS.test(trimmed)) {
      fields.push(line.replace(/^\s*final\s+/, '').trim());
      i++;
      continue;
    }
    prelude.push(line);
    i++;
  }

  // setup()/draw() определяются только в основной вкладке.
  if (!isMain) {
    return {
      imports,
      fields,
      prelude,
      methods: methods.filter((m) => m.name !== 'setup' && m.name !== 'draw'),
      classes,
    };
  }
  return { imports, fields, prelude, methods, classes };
}

function countBraces(line) {
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

// ── генерация Android-проекта ─────────────────────────────────────────────────────────

function gradleRoot(name) {
  return `// Сгенерировано Processing Studio
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "${name}"
include ':app'
`;
}

const GRADLEW_UNIX = `#!/bin/sh
# Gradle Wrapper — Processing Studio (macOS / Linux)
APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVACMD="$JAVA_HOME/bin/java"
else
  JAVACMD="java"
fi
exec "$JAVACMD" -Dorg.gradle.appname=gradlew -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
`;

const GRADLEW_BAT = `@echo off
setlocal
set APP_HOME=%~dp0
set CLASSPATH=%APP_HOME%gradle\\wrapper\\gradle-wrapper.jar
if defined JAVA_HOME (
  set "JAVACMD=%JAVA_HOME%\\bin\\java.exe"
) else (
  set "JAVACMD=java.exe"
)
"%JAVACMD%" -Dorg.gradle.appname=gradlew -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
`;

function gradleApp(settings) {
  return `plugins {
    id 'com.android.application'
}

android {
    namespace '${settings.packageName}'
    compileSdk ${settings.targetSdk}

    defaultConfig {
        applicationId "${settings.packageName}"
        minSdk ${settings.minSdk}
        targetSdk ${settings.targetSdk}
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
}
`;
}

function manifest(settings) {
  const perms = (settings.permissions || []).map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  const orientation = settings.orientation && settings.orientation !== 'unspecified'
    ? `\n            android:screenOrientation="${settings.orientation}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${perms}

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:exported="true"${orientation}
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|uiMode">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

function mainActivity(pkg, className, adaptiveUi) {
  const adaptiveImport = adaptiveUi ? `\nimport ${pkg}.AdaptiveUI;\n` : '\n';
  const attach = adaptiveUi
    ? `\n    AdaptiveUI.attach(sketch);`
    : '';
  return `package ${pkg};
${adaptiveImport}import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;

/** Точка входа: держит экран и передаёт результаты запросов разрешений скетчу. */
public class MainActivity extends Activity {

  private ${className} sketch;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    sketch = new ${className}(this);${attach}
    setContentView(sketch);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (sketch != null) sketch.onRequestPermissionsResult(requestCode, permissions, grantResults);
  }
}
`;
}

const RES_VALUES = (settings) => ({
  'res/values/strings.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${settings.name}</string>
</resources>
`,
  'res/values/colors.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1E1F22</color>
</resources>
`,
  'res/values/themes.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowBackground">#1E1F22</item>
        <item name="android:statusBarColor">#1E1F22</item>
    </style>
</resources>
`,
});

const LAUNCHER_ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;

const LAUNCHER_FOREGROUND = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#548AF7"
        android:pathData="M38,32 h18 a12,12 0 0 1 0,24 h-8 v20 h-10 z M48,42 h7 a4,4 0 0 1 0,8 h-7 z" />
</vector>
`;

async function copyDataAssets(root, write) {
  const listed = await window.electronAPI?.listFiles?.(joinPath(root, 'data'));
  const files = listed?.files || [];
  for (const file of files) {
    if (file.isDirectory || !file.path) continue;
    const res = await window.electronAPI?.getFileContent?.(file.path);
    if (!res?.success || res.content == null) continue;
    await write(`app/src/main/assets/${file.name}`, res.content);
  }
}

async function resolveAdaptiveSource(root, pkg, runtime) {
  const fallback = String(runtime?.adaptiveUi || ADAPTIVE_UI_JAVA).replace('%(package)s', pkg);
  if (!root) return fallback;
  try {
    const libRes = await window.electronAPI?.getFileContent?.(joinPath(root, 'libraries/AdaptiveUI.java'));
    const raw = libRes?.success ? String(libRes.content || '') : '';
    if (!raw || !/\bclass\s+AdaptiveUI\b/.test(raw)) return fallback;
    if (/^package\s+[\w.]+;/m.test(raw)) return raw.replace(/^package\s+[\w.]+;/m, `package ${pkg};`);
    return `package ${pkg};\n\n${raw}`;
  } catch {
    return fallback;
  }
}

/**
 * Создаёт Android-проект рядом со скетчем.
 * @returns {{ ok: boolean, path?: string, error?: string, files?: number }}
 */
async function exportAndroidProject({ root, sketchSource, sketchName, settings, runtime }) {
  if (!root) return { ok: false, error: 'Проект не открыт' };
  const pkg = sanitizePackageName(settings.packageName);
  const className = javaClassName(settings.name);
  const appDir = joinPath(root, 'android');
  const javaDir = joinPath(joinPath(joinPath(appDir, 'app'), 'src'), 'main');
  const javaPath = joinPath(javaDir, 'java');
  const resDir = joinPath(javaDir, 'res');
  const pkgPath = pkg.split('.').join('/');
  const javaPackageDir = joinPath(javaPath, pkgPath);
  const finalSettings = { ...settings, packageName: pkg, name: settings.name || className };

  const write = async (relative, content) => {
    const res = await window.electronAPI?.writeFile?.(joinPath(appDir, relative), content);
    if (!res || !res.success) throw new Error(res?.error || `Не удалось записать ${relative}`);
  };

  try {
    // Keep existing source files in android/: users may have edited the Gradle project.
    await write('settings.gradle', gradleRoot(finalSettings.name));
    await write('build.gradle', `// Сгенерировано Processing Studio\nplugins {\n    id 'com.android.application' version '8.5.2' apply false\n}\n`);
    await write('gradle.properties', `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nandroid.nonTransitiveRClass=true\nandroid.builder.sdkDownload=false\n`);
    await write('gradle/wrapper/gradle-wrapper.properties', `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`);
    await write('gradlew', GRADLEW_UNIX);
    await write('gradlew.bat', GRADLEW_BAT);
    await write('.gitignore', `/.gradle/\n/build/\n/app/build/\n/local.properties\n/captures/\n*.apk\n*.ap_\n`);
    await write('app/build.gradle', gradleApp(finalSettings));
    await write('app/proguard-rules.pro', '# Правила для Processing Studio\n');
    await write('app/src/main/AndroidManifest.xml', manifest(finalSettings));
    const adaptiveOn = !!finalSettings.adaptiveUi || sketchMentionsAdaptive(sketchSource);
    await write(`app/src/main/java/${pkgPath}/MainActivity.java`, mainActivity(pkg, className, adaptiveOn));
    await write(`app/src/main/java/${pkgPath}/${className}.java`, sketchToJava(sketchSource, className, pkg, { adaptiveUi: adaptiveOn }));
    await write(`app/src/main/java/${pkgPath}/PApplet.java`, runtime.pApplet.replace('%(package)s', pkg));
    await write(`app/src/main/java/${pkgPath}/PVector.java`, runtime.pVector.replace('%(package)s', pkg));
    await write(`app/src/main/java/${pkgPath}/PFont.java`, runtime.pFont.replace('%(package)s', pkg));
    if (runtime.json) {
      await write(`app/src/main/java/${pkgPath}/JSONObject.java`, runtime.json.replace('%(package)s', pkg));
    }
    await copyDataAssets(root, write);
    if (adaptiveOn) {
      await write(`app/src/main/java/${pkgPath}/AdaptiveUI.java`, await resolveAdaptiveSource(root, pkg, runtime));
    }
    for (const [file, content] of Object.entries(RES_VALUES(finalSettings))) {
      await write(`app/src/main/${file}`, content);
    }
    await write('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', LAUNCHER_ADAPTIVE);
    await write('app/src/main/res/drawable/ic_launcher_foreground.xml', LAUNCHER_FOREGROUND);
    const adaptiveNote = finalSettings.adaptiveUi
      ? `\n## Adaptive UI\n\nВ проект подключена библиотека \`AdaptiveUI\`: любой интерфейс из \`size()\` масштабируется под экран телефона, касания пересчитываются автоматически. Чтобы выключить: уберите \`AdaptiveUI.attach(sketch)\` в \`MainActivity\` или вызовите \`AdaptiveUI.detach(sketch)\`.\n`
      : '';
    await write('README.md', `# ${finalSettings.name}\n\nAndroid-проект, созданный Processing Studio из скетча \`${sketchName || finalSettings.sketch}\`.\n\n## Сборка\n\nВ IDE: **Запуск → Собрать**. На любом macOS / Windows / Linux студия сама найдёт JDK 17–21 и Android SDK или поставит их в \`Documents/ProcessingStudio/toolchain\`.\n\nВ папке \`android\` есть Gradle Wrapper: \`./gradlew assembleDebug\` (Windows: \`gradlew.bat\`). JDK задайте через \`JAVA_HOME\`, путь к SDK — в \`local.properties\` (файл локальный, в git не входит).\n\nЛибо откройте папку в Android Studio.\n\nПриложение использует собственный рантайм \`PApplet\` — Processing for Android не требуется.\n${adaptiveNote}\nPackage: \`${pkg}\`\nMin SDK: ${finalSettings.minSdk}, Target SDK: ${finalSettings.targetSdk}\n`);
    return { ok: true, path: appDir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


// ── device-transpile (Processing Studio) ──
/**
 * Converts a Processing sketch into JavaScript for the emulator.
 *
 * Two dialects are supported:
 *   • Java (the classic .pde): `void setup()`, `float x = 1.0;`, `PVector p = new PVector();`
 *   • JavaScript (p5.js style): `function setup() {}`
 *
 * The transformation is line-preserving: a line in the sketch keeps its number, so an error
 * reported by the runtime points at the original file.
 */

const JAVA_TYPES = [
  'int', 'float', 'double', 'boolean', 'char', 'byte', 'short', 'long',
  'String', 'Boolean', 'Integer', 'Float', 'Double', 'Long', 'Character',
  'PVector', 'PFont', 'PImage',
];

/** Events whose name in Processing is also a boolean — handlers and flags get separate names. */
const EVENT_HANDLERS = [
  'keyPressed', 'keyReleased', 'keyTyped',
  'mousePressed', 'mouseReleased', 'mouseClicked', 'mouseDragged', 'mouseMoved', 'mouseWheel',
  'touchStarted', 'touchMoved', 'touchEnded',
  'shake',
  'onPermissionGranted', 'onLocationChanged',
];

const GENERIC_TYPE = '(?:[A-Za-z_]\\w*)(?:\\s*<[^<>]*>)?(?:\\s*\\[\\s*\\])*';
const MODIFIERS = '(?:public|private|protected|static|final|abstract|native|synchronized)';

/** Splits a line into code / string / comment parts so that replacements never touch text. */
function splitParts(line) {
  const parts = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { parts.push({ type: 'code', text: buf }); buf = ''; } };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === ch) { j++; break; }
        j++;
      }
      flush();
      parts.push({ type: 'str', text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      flush();
      parts.push({ type: 'comment', text: line.slice(i) });
      break;
    }
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      const stop = end < 0 ? line.length : end + 2;
      flush();
      parts.push({ type: 'comment', text: line.slice(i, stop) });
      i = stop;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return parts;
}

/** Applies a replacement to the code parts of a line, keeping strings and comments intact. */
function mapCode(line, fn) {
  const parts = splitParts(line);
  let out = '';
  for (const part of parts) {
    out += part.type === 'code' ? fn(part.text) : part.text;
  }
  return out;
}

/** Removes the types from a parameter list: `int x, float y` → `x, y`. */
function stripParamTypes(params) {
  return params
    .replace(/@\w+(\([^)]*\))?\s*/g, '')
    .replace(new RegExp(`(?:final\\s+)?${GENERIC_TYPE}\\s+([A-Za-z_]\\w*)\\s*(?=,|$)`, 'g'), '$1');
}

function findClosing(text, open, close) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The text starts right after the opening bracket — finds its pair. */
function findClosingInside(text, close) {
  let depth = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const STATEMENT_START = /^\s*(?:return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|new|assert|yield|print|println)\b/;

/** Rewrites a method declaration: `void setup()` → `function setup()`. */
function transformDeclaration(code, javaMode, inClass) {
  if (STATEMENT_START.test(code)) return code;
  const re = new RegExp(`^(\\s*)((?:${MODIFIERS}\\s+)*)([A-Za-z_][\\w<>\\[\\],.]*)\\s+([A-Za-z_]\\w*)\\s*\\(`);
  const m = code.match(re);
  if (!m) return code;
  const indent = m[1];
  const returnType = m[3].trim();
  const name = m[4];
  const rest = code.slice(m[0].length);
  const close = findClosingInside(rest, ')');
  if (close < 0) return code;
  const params = rest.slice(0, close);
  // Java: `void f() throws Exception {` — в JS конструкции throws нет.
  const tail = rest.slice(close + 1).replace(/^(\s*)throws\s+[A-Za-z_][\w.]*(\s*,\s*[A-Za-z_][\w.]*)*\s*/, '$1');
  const newName = javaMode && EVENT_HANDLERS.includes(name)
    ? (name.startsWith('on') ? `__${name}` : '__on' + name.charAt(0).toUpperCase() + name.slice(1))
    : name;
  const head = inClass ? `${indent}${newName}` : `${indent}function ${newName}`;
  return `${head}(${stripParamTypes(params)})${tail}`;
}

/** Rewrites a constructor inside a class body: `Ball(float x) {` → `Ball(x) {`. */
function transformConstructor(code, inClass) {
  if (!inClass) return code;
  const re = /^(\s*)((?:public|private|protected)\s+)?([A-Z]\w*)\s*\(/;
  const m = code.match(re);
  if (!m) return code;
  const rest = code.slice(m[0].length);
  const close = findClosingInside(rest, ')');
  if (close < 0) return code;
  return `${m[1]}${m[3]}(${stripParamTypes(rest.slice(0, close))})${rest.slice(close + 1)}`;
}

/** Rewrites a variable declaration: `float x = 1.0;` → `let x = 1.0;`. */
function transformDeclarationTypes(code, javaMode, inClass) {
  if (!javaMode) return code;
  // Примитивные типы, коллекции и любые имена классов (SensorManager manager;).
  const typePattern = `(?:${JAVA_TYPES.join('|')}|ArrayList\\s*<[^<>]*>|HashMap\\s*<[^<>]*>|[A-Z][A-Za-z0-9_]*(?:\\s*<[^<>]*>)?)(?:\\s*\\[\\s*\\])*`;
  const mods = `(?:${MODIFIERS}|volatile|transient)`;
  if (inClass) {
    // Внутри класса поле остаётся полем: `float x, y;` → `x; y;`
    const re = new RegExp(`(^|[^\\w$.])((?:${mods}\\s+)*)(${typePattern})\\s+([A-Za-z_]\\w*(?:\\s*=\\s*[^;,]+)?(?:\\s*,\\s*[A-Za-z_]\\w*(?:\\s*=\\s*[^;,]+)?)*)\\s*;`, 'g');
    return code.replace(re, (_all, pre, _mods, _type, names) => {
      const parts = names.split(',').map((part) => part.trim()).filter(Boolean);
      return pre + parts.map((part) => `${part};`).join(' ');
    });
  }
  // volatile/transient — просто модификаторы, поле остаётся изменяемым.
  const re = new RegExp(`(^|[^\\w$.])((?:(?:final|volatile|transient)\\s+)*)(${typePattern})\\s+([A-Za-z_]\\w*)`, 'g');
  return code.replace(re, (_all, pre, mods, _type, name) => `${pre}${/\bfinal\b/.test(mods) ? 'const ' : 'let '}${name}`);
}

/** `for (PVector p : list)` → `for (const p of list)`. */
function transformForEach(code) {
  const re = /for\s*\(\s*(?:final\s+)?(?:[A-Za-z_]\w*)(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+([A-Za-z_]\w*)\s*:\s*([^)]*)\)/g;
  return code.replace(re, (_all, name, expr) => `for (const ${name} of ${expr.trim()})`);
}

function transformCasts(code) {
  return code
    .replace(/(?<![\w$.])\((?:float|double)\)\s*/g, '1*')
    .replace(/(?<![\w$.])\((?:int|long|short|byte|char)\)\s*/g, '~~')
    // Приведение к классу: (SensorManager) expr — убираем, если дальше идёт выражение.
    .replace(/(?<![\w$.])\(([A-Z][A-Za-z0-9_]*(?:\s*<[^<>]*>)?)\)\s*(?=[A-Za-z_!~+\-(])/g, '')
    .replace(/\bnew\s+(ArrayList|HashMap)\s*<[^<>]*>/g, 'new $1')
    .replace(/\bMath\.random\s*\(\s*\)/g, 'random')
    .replace(/\bString\.format\s*\(/g, 'format');
}

function stripNumericSuffixes(code) {
  return code.replace(/(?<![\w.$])(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[fFdDlL]\b/g, '$1');
}

/** In Java mode `keyPressed` is both a handler and a boolean — the boolean gets its own name. */
function renameBooleans(code) {
  return code
    .replace(/\bkeyPressed\b(?!\s*\()/g, '__keyDown')
    .replace(/\bmousePressed\b(?!\s*\()/g, '__mouseDown');
}

/** Привычки Java, которых нет в JS. */
function transformJavaIdioms(code) {
  return code
    // new float[60] → new Array(60).fill(0)
    .replace(/\bnew\s+[A-Za-z_]\w*(?:\s*<[^<>]*>)?\s*\[\s*([^\]]+?)\s*\]/g, 'new Array($1).fill(0)')
    // synchronized (values) { … } → { … }: в JS блокировки нет
    .replace(/\bsynchronized\s*\([^)]*\)\s*\{/g, '{')
    .replace(/\.length\s*\(\s*\)/g, '.length')                       // s.length() → s.length
    .replace(/\bInteger\.parseInt\s*\(/g, 'parseInt(')
    .replace(/\bLong\.parseLong\s*\(/g, 'parseInt(')
    .replace(/\b(?:Float|Double)\.parse(?:Float|Double)\s*\(/g, 'parseFloat(')
    .replace(/\bBoolean\.parseBoolean\s*\(/g, 'parseBool(')
    .replace(/\bString\.valueOf\s*\(/g, 'String(')
    .replace(/\bArrays\.sort\s*\(\s*([A-Za-z_]\w*)\s*\)/g, '$1.sort()');
}

/** Ищет парную фигурную скобку, пропуская строки и комментарии. */
function matchBrace(code, open) {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) break;
        i++;
      }
    } else if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    } else if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 2;
      continue;
    } else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Java разрешает несколько catch подряд, JS — только один.
 * Второй и следующие блоки комментируем: их тела выполняются внутри первого catch.
 * Номера строк при этом сохраняются.
 */
function mergeJavaCatches(code) {
  const re = /catch\s*\(/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', m.index);
    if (open < 0) break;
    const end = matchBrace(code, open);
    if (end < 0) break;
    const rest = code.slice(end + 1);
    const next = /^\s*catch\s*\(/.exec(rest);
    if (!next) continue;
    // Следующий catch идёт сразу за текущим: объединяем.
    const nextHeader = end + 1 + rest.indexOf('catch');
    const nextOpen = code.indexOf('{', nextHeader);
    const nextEnd = matchBrace(code, nextOpen);
    if (nextEnd < 0) break;
    // Закрывающая скобка первого catch и заголовок второго уходят в комментарий:
    // тело второго catch остаётся внутри первого (номера строк сохраняются).
    const before = code.slice(last, nextHeader).replace(/\s+$/, '');
    const closeIdx = last + before.length - 1;
    out += code.slice(last, closeIdx);
    out += '/* ' + code.slice(closeIdx, nextOpen + 1) + ' */';
    // Скобка второго catch закрывает первый — лишней она не остаётся.
    out += code.slice(nextOpen + 1, nextEnd + 1);
    last = nextEnd + 1;
    re.lastIndex = last;
  }
  out += code.slice(last);
  return out;
}

/**
 * В Java поле класса доступно без this., в JS — только через this.
 * Квалифицируем обращения к полям внутри методов (параметры и локальные переменные
 * перекрывают поле — их не трогаем).
 */
function qualifyClassFields(code) {
  const classRe = /^(?:[ \t]*)(?:(?:public|private|protected|static|final|abstract)\s+)*class\s+[A-Za-z_]\w*/gm;
  let out = '';
  let last = 0;
  let m;
  while ((m = classRe.exec(code))) {
    const bodyStart = code.indexOf('{', m.index);
    if (bodyStart < 0) break;
    const bodyEnd = matchBrace(code, bodyStart);
    if (bodyEnd < 0) break;
    out += code.slice(last, bodyStart + 1);
    out += processClassBody(code.slice(bodyStart + 1, bodyEnd), m[0].match(/class\s+([A-Za-z_]\w*)/)?.[1] || '');
    out += '}';
    last = bodyEnd + 1;
    classRe.lastIndex = bodyEnd;
  }
  out += code.slice(last);
  return out;
}

const FIELD_DECL_RE = /^[ \t]*(?:(?:public|private|protected|static|final|volatile|transient)\s+)*[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+([A-Za-z_]\w*(?:\s*=\s*[^;,]+)?(?:\s*,\s*[A-Za-z_]\w*(?:\s*=\s*[^;,]+)?)*)\s*;/;

function collectFieldNames(body) {
  const fields = new Set();
  for (const line of body.split('\n')) {
    const m = line.match(FIELD_DECL_RE);
    if (!m) continue;
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].trim();
      if (name) fields.add(name);
    }
  }
  return fields;
}

function processClassBody(body, className = '') {
  const fields = collectFieldNames(body);
  const methods = collectMethodNames(body, className);
  if (!fields.size && !methods.size) return body;
  const methodRe = /(?:^|\n)([ \t]*)(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:([A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = methodRe.exec(body))) {
    const open = body.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) break;
    const end = matchBrace(body, open);
    if (end < 0) break;
    let header = body.slice(m.index, open + 1);
    // Конструктор в Java называется как класс, в JS — всегда constructor.
    if (className && m[3] === className) {
      header = header.replace(new RegExp(`\\b${className}\\s*\\(`), 'constructor(');
    }
    // Типы параметров в JS не нужны.
    header = header.replace(/\(([^)]*)\)/, (_all, params) => `(${stripParamTypes(params)})`);
    const methodBody = body.slice(open + 1, end);
    // Параметры перекрывают поля.
    const shadow = new Set();
    for (const part of (m[4] || '').split(',')) {
      const name = part.trim().split(/\s+/).pop();
      if (name && /^[A-Za-z_]\w*$/.test(name)) shadow.add(name);
    }
    // Локальные переменные тоже перекрывают поля.
    for (const lm of methodBody.matchAll(/(?:^|[;{]\s*)(?:(?:final\s+)?[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+)([A-Za-z_]\w*)/g)) shadow.add(lm[1]);
    for (const fm of methodBody.matchAll(/for\s*\(\s*(?:final\s+)?[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)/g)) shadow.add(fm[1]);
    for (const cm of methodBody.matchAll(/catch\s*\(\s*[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)/g)) shadow.add(cm[1]);
    out += body.slice(last, m.index) + header;
    out += qualifyIdentifiers(methodBody, fields, shadow, methods);
    out += '}';
    last = end + 1;
    methodRe.lastIndex = end;
  }
  out += body.slice(last);
  return out;
}

function qualifyIdentifiers(text, fields, shadow, methods = new Set()) {
  const parts = splitParts(text);
  return parts.map((part) => {
    if (part.type !== 'code') return part.text;
    let out = part.text;
    for (const field of fields) {
      if (shadow.has(field)) continue;
      const re = new RegExp(`(^|[^\\w$.])${field}\\b`, 'gm');
      out = out.replace(re, (_all, pre) => `${pre}this.${field}`);
    }
    // Вызов метода своего класса тоже требует this.
    for (const method of methods) {
      const re = new RegExp(`(^|[^\\w$.])${method}\\s*\\(`, 'gm');
      out = out.replace(re, (_all, pre) => `${pre}this.${method}(`);
    }
    return out;
  }).join('');
}

/** Имена методов, объявленных в классе (конструктор исключается). */
function collectMethodNames(body, className) {
  const names = new Set();
  const re = /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/gm;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1];
    if (!name || name === className) continue;
    if (/^(if|for|while|switch|catch|return|new|typeof|function)$/.test(name)) continue;
    names.add(name);
  }
  return names;
}

/** `catch (Exception e)` → `catch (e)`: тип исключения в JS не нужен. */
function transformCatch(code) {
  return code.replace(/catch\s*\(\s*(?:final\s+)?[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?\s+([A-Za-z_]\w*)\s*\)/g, 'catch ($1)');
}

/** Внутренние классы sketch не наследуют ничего: extends/implements убираем. */
function stripClassInheritance(code) {
  return code.replace(/\b(class\s+[A-Za-z_]\w*)\s+(extends\s+[A-Za-z_][\w.]*)?\s*(implements\s+[A-Za-z_][\w.]*(\s*,\s*[A-Za-z_][\w.]*)*)?/g, '$1');
}

/** `super.onPause()` в Java-скетче — вызов базовой реализации, в эмуляторе он не нужен. */
function stripSuperCalls(code) {
  return code.replace(/\bsuper\.(onPause|onResume|onStop|onDestroy|onRestart)\s*\(\s*\)\s*;/g, 'void 0;')
    .replace(/\bsuper\.([A-Za-z_]\w*)\s*\(/g, '$1(');
}

/** `key` in Processing is a char: `key == 'a'` and `key == 97` both work. In JS the key is a string, so a comparison with a code goes to the char code. */
function fixCharComparisons(code) {
  return code.replace(/\bkey\s*([=!]=)\s*(\d{1,3})\b/g, 'key.charCodeAt(0) $1 $2');
}

/** Detects the dialect of the sketch. */
function detectProcessingMode(source) {
  const src = String(source || '');
  if (/^\s*(?:from\s+processing|import\s+processing\b)/m.test(src) && /\bdef\s+\w+\s*\(/.test(src)) return 'python';
  if (/^\s*(?:public\s+|private\s+|protected\s+|static\s+)*void\s+\w+\s*\(/m.test(src)) return 'java';
  if (/\b(?:int|float|double|boolean|PVector|String)\s+[A-Za-z_]\w*\s*=/.test(src)) return 'java';
  if (/\bfunction\s+(?:setup|draw)\s*\(/.test(src)) return 'js';
  if (/\b(?:setup|draw)\s*\(\s*\)\s*\{/.test(src)) return 'js';
  return 'java';
}

/**
 * @returns {{ code: string, mode: string, warnings: string[] }}
 */
function transpileProcessing(source) {
  const src = String(source || '');
  const mode = detectProcessingMode(src);
  const warnings = [];
  if (mode === 'python') {
    return { code: '', mode, warnings: ['Python-режим Processing не поддерживается эмулятором — перепишите скетч на Java или JS.'] };
  }
  const javaMode = mode === 'java';

  // Brace context: we need to know whether a line sits directly in a class body —
  // there the declarations become class fields, not variables.
  const stack = [];
  let pending = null;

  const lines = qualifyClassFields(mergeJavaCatches(src)).split('\n');
  const out = lines.map((raw) => {
    const inClass = stack.length > 0 && stack[stack.length - 1] === 'class';

    let line = mapCode(raw, (code) => code
      .replace(/^\s*import\s+[\w.]+(?:\.\*)?\s*;?\s*$/, '')
      .replace(/^\s*package\s+[\w.]+\s*;?\s*$/, '')
      .replace(/^\s*@\w+(\([^)]*\))?\s*$/, ''));
    if (!line.trim()) return line;

    line = mapCode(line, (code) => transformForEach(code));
    line = mapCode(line, (code) => transformConstructor(code, inClass));
    line = mapCode(line, (code) => transformDeclaration(code, javaMode, inClass));
    const isClassDecl = /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*class\b/.test(line);
    const isCatch = /\bcatch\s*\(/.test(line);
    if (!isClassDecl && !isCatch) {
      line = mapCode(line, (code) => transformDeclarationTypes(code, javaMode, inClass));
    }
    if (isCatch) line = mapCode(line, (code) => transformCatch(code));
    if (javaMode) line = mapCode(line, (code) => transformJavaIdioms(code));
    line = mapCode(line, (code) => transformCasts(code));
    line = mapCode(line, (code) => stripNumericSuffixes(code));
    if (javaMode) line = mapCode(line, (code) => renameBooleans(code));
    if (javaMode) line = mapCode(line, (code) => fixCharComparisons(code));
    if (javaMode) line = mapCode(line, (code) => stripClassInheritance(code));
    if (javaMode) line = mapCode(line, (code) => stripSuperCalls(code));

    // Track the brace context for the next lines.
    const isClass = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\s+\w+/.test(line);
    const isMethod = /^\s*(?:function\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*\{?\s*$/.test(line)
      || /^\s*(?:function\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*\{/.test(line);
    if (isClass) pending = 'class';
    else if (isMethod) pending = 'method';
    for (const part of splitParts(line)) {
      if (part.type !== 'code') continue;
      for (const ch of part.text) {
        if (ch === '{') {
          stack.push(pending || 'block');
          pending = null;
        } else if (ch === '}') {
          stack.pop();
        }
      }
    }
    return line;
  });

  const code = out.join('\n');
  if (!/\b(?:setup|draw)\s*\(/.test(code)) {
    warnings.push('В скетче нет setup()/draw() — экран останется пустым.');
  }
  return { code, mode, warnings };
}


// ── device-runtime (Processing Studio) ──
/**
 * Runtime of the phone emulator: a compact engine compatible with Processing.
 *
 * The panel copies this function into the emulator frame with toString(), so the body must not
 * reference anything outside itself: no imports, no module-level helpers, no closures over
 * module variables. Everything lives inside.
 *
 * Supported: canvas, shapes, text, colors, matrices, math, PVector, ArrayList/HashMap,
 * mouse/touch/keyboard events, sensors (accelerometer, orientation, shake), println/console.
 */

function createProcessingRuntime(options) {
  const opts = options || {};
  const TAG = 'frogee-device';
  const HOST = 'frogee-device-host';
  const W = window;

  const post = (msg) => {
    try { parent.postMessage(Object.assign({ source: TAG }, msg), '*'); } catch (err) { /* the frame is gone */ }
  };

  // ── State ────────────────────────────────────────────────────────────────────────────────
  const S = {
    w: opts.width || 390,
    h: opts.height || 844,
    dpr: opts.dpr || 2,
    sketchW: opts.width || 390,
    sketchH: opts.height || 844,
    fill: [255, 255, 255, 255],
    stroke: [0, 0, 0, 255],
    doFill: true,
    doStroke: true,
    weight: 1,
    rectMode: 0,    // CORNER
    ellipseMode: 3, // CENTER
    imageMode: 0,   // CORNER
    textSize: 12,
    textLeading: 0,
    font: 'sans-serif',
    alignH: 39,     // LEFT
    alignV: 0,      // BASELINE
    styleStack: [],
    loop: true,
    frame: 0,
    targetFps: 60,
    last: 0,
    delta: 0,
    started: Date.now(),
    mouseX: 0, mouseY: 0, pmouseX: 0, pmouseY: 0,
    mouseDown: false, mouseButton: 'LEFT',
    touches: [],
    key: '', keyCode: 0, keyDown: false,
    accelX: 0, accelY: 0, accelZ: 9.81,
    gyroX: 0, gyroY: 0, gyroZ: 0,
    magX: 0, magY: 0, magZ: 0,
    rotation: 0, orientation: 'portrait', heading: 0,
    lat: 0, lon: 0, alt: 0, accuracy: 0,
    permissions: Object.assign({}, opts.permissions || {}),
    orientationLock: 0,        // 0 — не зафиксирована
    keyboard: false,
    paused: false,
    light: 320,
    proximity: 8,
    dataFiles: Object.assign({}, opts.dataFiles || {}),
    images: new Map(),
    dead: false,
    showTouches: !!opts.showTouches,
    shape: null,
    shapeMode: 0,
    fpsFrames: 0,
    fpsSince: 0,
    fpsValue: 0,
  };

  const fail = (err) => {
    if (S.dead) return;
    S.dead = true;
    post({
      type: 'error',
      message: String((err && err.message) || err),
      stack: String((err && err.stack) || ''),
    });
  };

  // ── Canvas ───────────────────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.style.cssText = 'position:absolute;left:0;top:0;';
  document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
  document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
  document.body.appendChild(canvas);

  const fitCanvas = () => {
    const vw = W.innerWidth || S.w;
    const vh = W.innerHeight || S.h;
    const k = Math.min(vw / S.sketchW, vh / S.sketchH);
    canvas.style.width = S.sketchW * k + 'px';
    canvas.style.height = S.sketchH * k + 'px';
    canvas.style.left = (vw - S.sketchW * k) / 2 + 'px';
    canvas.style.top = (vh - S.sketchH * k) / 2 + 'px';
  };

  const applySize = () => {
    canvas.width = Math.max(1, Math.round(S.sketchW * S.dpr));
    canvas.height = Math.max(1, Math.round(S.sketchH * S.dpr));
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.lineWidth = S.weight;
    fitCanvas();
  };

  const toSketch = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const sx = S.sketchW / Math.max(1, r.width);
    const sy = S.sketchH / Math.max(1, r.height);
    return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
  };

  // ── Colors ───────────────────────────────────────────────────────────────────────────────
  const color = (...args) => {
    if (!args.length) return [0, 0, 0, 255];
    if (args.length === 1) {
      const v = args[0];
      if (Array.isArray(v)) return v.length === 4 ? v.slice() : [v[0], v[1], v[2], 255];
      if (typeof v === 'string') {
        const h = v.trim().replace('#', '');
        if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255];
        if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
        return [0, 0, 0, 255];
      }
      const n = Math.max(0, Math.min(255, Math.round(v)));
      return [n, n, n, 255];
    }
    if (args.length === 2) {
      const g = Math.max(0, Math.min(255, Math.round(args[0])));
      return [g, g, g, Math.round(args[1] <= 1 ? args[1] * 255 : args[1])];
    }
    if (args.length === 3) return [args[0] | 0, args[1] | 0, args[2] | 0, 255];
    return [args[0] | 0, args[1] | 0, args[2] | 0, Math.round(args[3] <= 1 ? args[3] * 255 : args[3])];
  };

  const css = (c) => {
    const v = color(c);
    return 'rgba(' + (v[0] | 0) + ',' + (v[1] | 0) + ',' + (v[2] | 0) + ',' + ((v[3] === undefined ? 255 : v[3]) / 255) + ')';
  };

  // ── Math / random ────────────────────────────────────────────────────────────────────────
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  let randomGen = rng(1);
  const random = (a, b) => {
    if (a === undefined) return randomGen();
    if (b === undefined) return randomGen() * a;
    return a + randomGen() * (b - a);
  };
  const randomSeed = (s) => { randomGen = rng(s); };

  const perm = new Uint8Array(512);
  const buildPerm = (seed) => {
    const r = rng(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  };
  buildPerm(1);

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad3 = (h, x, y, z) => {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  const noise = (x, y, z) => {
    y = y || 0; z = z || 0;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(perm[AA] & 15, x, y, z), grad3(perm[BA] & 15, x - 1, y, z), u),
        lerp(grad3(perm[AB] & 15, x, y - 1, z), grad3(perm[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad3(perm[AA + 1] & 15, x, y, z - 1), grad3(perm[BA + 1] & 15, x - 1, y, z - 1), u),
        lerp(grad3(perm[AB + 1] & 15, x, y - 1, z - 1), grad3(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
  };
  const noiseSeed = (s) => buildPerm(s);

  const map = (v, a, b, c, d, clamp) => {
    const r = c + ((v - a) / (b - a)) * (d - c);
    if (!clamp) return r;
    return d > c ? Math.max(c, Math.min(d, r)) : Math.max(d, Math.min(c, r));
  };
  const constrain = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const norm = (v, a, b) => map(v, a, b, 0, 1);
  const radians = (d) => (d * Math.PI) / 180;
  const degrees = (r) => (r * 180) / Math.PI;
  const sq = (v) => v * v;
  const mag = (x, y) => Math.hypot(x, y);
  const shuffle = (arr, seed) => {
    const r = seed === undefined ? randomGen : rng(seed);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  const lerpColor = (c1, c2, amt) => {
    const a = color(c1), b = color(c2);
    return [
      Math.round(lerp(a[0], b[0], amt)),
      Math.round(lerp(a[1], b[1], amt)),
      Math.round(lerp(a[2], b[2], amt)),
      Math.round(lerp(a[3] === undefined ? 255 : a[3], b[3] === undefined ? 255 : b[3], amt)),
    ];
  };

  // ── Events ───────────────────────────────────────────────────────────────────────────────
  const callHandler = (name, ...args) => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    const fn = W['__on' + cap] || W['__' + name] || W[name];
    if (typeof fn === 'function') {
      try { fn(...args); } catch (err) { fail(err); }
    }
  };

  const addTouch = (id, x, y) => {
    for (const t of S.touches) if (t.id === id) { t.x = x; t.y = y; return; }
    S.touches.push({ id, x, y, area: 0, pressure: 0 });
  };
  const removeTouch = (id) => { S.touches = S.touches.filter((t) => t.id !== id); };

  const onPointerDown = (e) => {
    const p = toSketch(e.clientX, e.clientY);
    S.mouseX = p.x; S.mouseY = p.y; S.pmouseX = p.x; S.pmouseY = p.y;
    S.mouseDown = true;
    S.mouseButton = e.button === 2 ? 'RIGHT' : (e.button === 1 ? 'CENTER' : 'LEFT');
    addTouch(e.pointerId, p.x, p.y);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
    callHandler('mousePressed', e);
    callHandler('touchStarted', e);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const p = toSketch(e.clientX, e.clientY);
    S.pmouseX = S.mouseX; S.pmouseY = S.mouseY;
    S.mouseX = p.x; S.mouseY = p.y;
    if (S.mouseDown) {
      addTouch(e.pointerId, p.x, p.y);
      callHandler('mouseDragged', e);
      callHandler('touchMoved', e);
    } else {
      callHandler('mouseMoved', e);
    }
  };

  const onPointerUp = (e) => {
    const p = toSketch(e.clientX, e.clientY);
    S.mouseX = p.x; S.mouseY = p.y;
    S.mouseDown = false;
    removeTouch(e.pointerId);
    callHandler('mouseReleased', e);
    callHandler('touchEnded', e);
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };

  const onKeyDown = (e) => {
    S.key = e.key === undefined ? '' : e.key;
    S.keyCode = e.keyCode || e.which || 0;
    S.keyDown = true;
    callHandler('keyPressed', e);
  };
  const onKeyUp = (e) => { S.keyDown = false; callHandler('keyReleased', e); };
  const onKeyTyped = (e) => callHandler('keyTyped', e);
  const onWheel = (e) => {
    e.preventDefault();
    callHandler('mouseWheel', { getCount: () => (e.deltaY < 0 ? -1 : 1), count: e.deltaY < 0 ? -1 : 1, delta: e.deltaY });
  };

  // ── Drawing ──────────────────────────────────────────────────────────────────────────────
  const paint = () => {
    if (S.doFill) { ctx.fillStyle = css(S.fill); ctx.fill(); }
    if (S.doStroke) { ctx.strokeStyle = css(S.stroke); ctx.lineWidth = S.weight; ctx.stroke(); }
  };

  const rectCoords = (x, y, w, h) => {
    if (S.rectMode === 1) return [Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h)];
    if (S.rectMode === 3) return [x - w / 2, y - h / 2, w, h];
    if (S.rectMode === 2) return [x - w / 2, y - h / 2, w, h];
    return [x, y, w, h];
  };

  const ellipseCoords = (x, y, w, h) => {
    if (S.ellipseMode === 1) return [(x + x + w) / 2, (y + y + h) / 2, Math.abs(w) / 2, Math.abs(h) / 2];
    if (S.ellipseMode === 2) return [x, y, Math.abs(w), Math.abs(h)];
    return [x, y, Math.abs(w) / 2, Math.abs(h) / 2];
  };

  const alignToCtx = () => {
    ctx.textAlign = S.alignH === 3 ? 'center' : (S.alignH === 33 ? 'right' : 'left');
    ctx.textBaseline = S.alignV === 101 ? 'top' : (S.alignV === 102 ? 'bottom' : 'alphabetic');
  };

  // Наконечник и соединение штриха: принимаем и числа Processing, и строки.
  const capName = (c) => {
    if (typeof c === 'string') return c.toLowerCase();
    if (c === 0) return 'butt';
    if (c === 1) return 'square';
    return 'round';
  };
  const joinName = (j) => {
    if (typeof j === 'string') return j.toLowerCase();
    if (j === 0) return 'miter';
    if (j === 3) return 'bevel';
    return 'round';
  };

  /**
   * В Processing key — это char, поэтому сравнения работают и с буквой ('a'),
   * и с её кодом (97). В JS тот же объект сравнивается с обоими.
   */
  const makeChar = (ch) => {
    const text = String(ch ?? '');
    const obj = new String(text);
    obj[Symbol.toPrimitive] = (hint) => (hint === 'number' ? (text.charCodeAt(0) || 0) : text);
    return obj;
  };

  // ── Android: настройки и активность ─────────────────────────────────────────────────────
  const PREFS = {
    data: Object.assign({}, opts.preferences || {}),
    save() { post({ type: 'prefs', data: PREFS.data }); },
    contains(k) { return Object.prototype.hasOwnProperty.call(PREFS.data, k); },
    remove(k) { delete PREFS.data[k]; PREFS.save(); },
    clear() { PREFS.data = {}; PREFS.save(); },
    getString(k, d) { return PREFS.contains(k) ? String(PREFS.data[k]) : (d === undefined ? null : d); },
    putString(k, v) { PREFS.data[k] = String(v); PREFS.save(); },
    getInt(k, d) { return PREFS.contains(k) ? parseInt(PREFS.data[k], 10) : (d === undefined ? 0 : d); },
    putInt(k, v) { PREFS.data[k] = Math.round(Number(v) || 0); PREFS.save(); },
    getFloat(k, d) { return PREFS.contains(k) ? parseFloat(PREFS.data[k]) : (d === undefined ? 0 : d); },
    putFloat(k, v) { PREFS.data[k] = Number(v) || 0; PREFS.save(); },
    getBoolean(k, d) { return PREFS.contains(k) ? !!PREFS.data[k] : (d === undefined ? false : d); },
    putBoolean(k, v) { PREFS.data[k] = !!v; PREFS.save(); },
  };

  const pendingPermissions = [];

  const ACTIVITY = {
    getPackageName: () => opts.packageName || 'com.example.sketch',
    finish() { post({ type: 'finish' }); },
    getPreferences: () => PREFS,
    requestPermission: (permission, callback) => API.requestPermission(permission, callback),
    hasPermission: (permission) => !!S.permissions[String(permission)],
    runOnUiThread: (fn) => { try { if (typeof fn === 'function') fn(); } catch (err) { fail(err); } },
    getSensorManager: () => SENSOR_MANAGER,
    getWindowManager: () => ({
      getDefaultDisplay: () => ({ getWidth: () => S.sketchW, getHeight: () => S.sketchH, getRotation: () => S.rotation }),
    }),
    getResources: () => ({
      getDisplayMetrics: () => ({ widthPixels: Math.round(S.sketchW * S.dpr), heightPixels: Math.round(S.sketchH * S.dpr), density: S.dpr }),
    }),
  };

  // ── JSON: как в processing.data ───────────────────────────────────────────────────────
  class JSONArray {
    constructor(data) { this.data = Array.isArray(data) ? data : []; }
    size() { return this.data.length; }
    getInt(i) { return Math.trunc(Number(this.data[i]) || 0); }
    getFloat(i) { return Number(this.data[i]) || 0; }
    getString(i) { return String(this.data[i] ?? ''); }
    getJSONObject(i) { const v = this.data[i]; return (v && typeof v === 'object') ? new JSONObject(v) : null; }
    getJSONArray(i) { const v = this.data[i]; return Array.isArray(v) ? new JSONArray(v) : null; }
    getStringArray(i) { const v = this.data[i]; return Array.isArray(v) ? v.map(String) : null; }
  }

  class JSONObject {
    constructor(data) { this.data = (data && typeof data === 'object') ? data : {}; }
    hasKey(key) { return Object.prototype.hasOwnProperty.call(this.data, key); }
    getString(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? null : fallback) : String(v); }
    getInt(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? 0 : fallback) : Math.trunc(Number(v) || 0); }
    getFloat(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? 0 : fallback) : Number(v) || 0; }
    getBoolean(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? false : fallback) : !!v; }
    getJSONObject(key) { const v = this.data[key]; return (v && typeof v === 'object' && !Array.isArray(v)) ? new JSONObject(v) : null; }
    getJSONArray(key) { const v = this.data[key]; return Array.isArray(v) ? new JSONArray(v) : null; }
    getStringArray(key) { const v = this.data[key]; return Array.isArray(v) ? v.map(String) : null; }
    setString(key, value) { this.data[key] = String(value); }
    setInt(key, value) { this.data[key] = Math.trunc(Number(value) || 0); }
    setFloat(key, value) { this.data[key] = Number(value) || 0; }
  }

  // ── Сенсоры: шина SensorManager, как в Processing for Android ──────────────────────────
  const sensorListeners = [];

  const sensorValues = (type) => {
    switch (type) {
      case 'accelerometer': return [S.accelX, S.accelY, S.accelZ];
      case 'linear': return [S.accelX, S.accelY, S.accelZ];
      case 'gyroscope': return [S.gyroX, S.gyroY, S.gyroZ];
      case 'magnetic': return [S.magX, S.magY, S.magZ];
      case 'light': return [S.light];
      case 'proximity': return [S.proximity];
      case 'rotation': return [0, 0, 0, 1];
      default: return [0, 0, 0];
    }
  };

  const SENSOR_MANAGER = {
    getDefaultSensor(type) {
      const key = String(type);
      return { type: key, getName: () => key, getType: () => key };
    },
    registerListener(listener, sensor, delay) {
      if (!listener || !sensor) return false;
      sensorListeners.push({ listener, type: String(sensor.type), delay: delay || 1 });
      return true;
    },
    unregisterListener(listener) {
      for (let i = sensorListeners.length - 1; i >= 0; i--) {
        if (sensorListeners[i].listener === listener) sensorListeners.splice(i, 1);
      }
      return true;
    },
  };

  const tickSensors = () => {
    if (!sensorListeners.length) return;
    for (const entry of sensorListeners.slice()) {
      const event = {
        values: sensorValues(entry.type),
        sensor: { type: entry.type, getName: () => entry.type },
        accuracy: 3,
        timestamp: Date.now(),
      };
      try { entry.listener.onSensorChanged(event); } catch (err) { fail(err); }
    }
  };

  const CONTEXT = {
    SENSOR_SERVICE: 'sensor',
    getSystemService(name) {
      if (name === 'sensor' || name === 'SensorManager') return SENSOR_MANAGER;
      return null;
    },
    getPackageName: () => opts.packageName || 'com.example.sketch',
    getAssets: () => ({ open: (name) => Promise.resolve(S.dataFiles[name] || null) }),
  };

  // ── API ──────────────────────────────────────────────────────────────────────────────────
  const API = {
    // constants
    CENTER: 3, LEFT: 39, RIGHT: 33, TOP: 101, BOTTOM: 102, BASELINE: 0,
    CORNER: 0, CORNERS: 1, RADIUS: 2,
    POINTS: 0, LINES: 1, TRIANGLES: 2, QUADS: 3, CLOSE: 4,
    POLYGON: 9, PATH: 10, GEOMETRY: 11, GROUP: 13, TEXT: 14, PRIMITIVE: 5,
    PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4,
    DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EPSILON: 0.0001,

    // Рендереры (в эмуляторе всегда 2D)
    DEFAULT: 0, P2D: 1, P3D: 2, FX2D: 3, AR: 4, METRO: 5, WEBGL: 2, OPENGL: 2,

    // Ориентация экрана (как в android.content.pm.ActivityInfo)
    PORTRAIT: 0, LANDSCAPE: 1, REVERSE_PORTRAIT: 2, REVERSE_LANDSCAPE: 3, UNKNOWN: 4,

    // Коды клавиш
    CODED: 65535, ENTER: 10, RETURN: 13, BACKSPACE: 8, TAB: 9, ESC: 27, DELETE: 127,
    UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, CONTROL: 17, ALT: 18, SHIFT: 16,

    // Типы сенсоров Android
    Sensor: {
      TYPE_ACCELEROMETER: 'accelerometer',
      TYPE_GYROSCOPE: 'gyroscope',
      TYPE_MAGNETIC_FIELD: 'magnetic',
      TYPE_LIGHT: 'light',
      TYPE_PROXIMITY: 'proximity',
      TYPE_ROTATION_VECTOR: 'rotation',
      TYPE_LINEAR_ACCELERATION: 'linear',
    },
    SensorManager: { SENSOR_DELAY_FASTEST: 0, SENSOR_DELAY_GAME: 1, SENSOR_DELAY_UI: 2, SENSOR_DELAY_NORMAL: 3 },
    Context: { SENSOR_SERVICE: 'sensor' },

    // Наконечники и соединения штриха
    PROJECT: 0, SQUARE: 1, ROUND: 2, MITER: 0, BEVEL: 3,

    ADAPTIVE_CONTAIN: 0, ADAPTIVE_COVER: 1, ADAPTIVE_STRETCH: 2,
    AdaptiveUI: {
      CONTAIN: 0, COVER: 1, STRETCH: 2,
      attach() { /* эмулятор уже вписывает холст в рамку телефона */ },
      detach() {},
      enabled() { return true; },
      scale() { return 1; },
      screenX(_app, x) { return x; },
      screenY(_app, y) { return y; },
      designX(_app, x) { return x; },
      designY(_app, y) { return y; },
      s(_app, value) { return value; },
    },

    // canvas
    size(w, h, renderer) {
      if (renderer !== undefined && renderer !== null && renderer !== API.P2D && renderer !== API.FX2D) {
        const name = renderer === API.P3D || renderer === API.WEBGL ? 'P3D/WEBGL' : String(renderer);
        post({ type: 'log', level: 'warn', text: `Рендерер ${name} не поддерживается — рисуем в 2D (P2D).` });
      }
      S.sketchW = Math.max(1, Math.round(w));
      S.sketchH = Math.max(1, Math.round(h));
      applySize();
    },
    fullScreen() { applySize(); },
    createCanvas(w, h) { API.size(w, h); return { elt: canvas }; },
    noCanvas() { /* the canvas always exists */ },
    pixelDensity(d) { if (d === undefined) return S.dpr; S.dpr = d; applySize(); },
    /** В Processing for Android это переменная: `24 * displayDensity`. Поддерживаем и вызов. */
    displayDensity() { return S.dpr; },
    get width() { return S.sketchW; },
    get height() { return S.sketchH; },
    get pixelWidth() { return canvas.width; },
    get pixelHeight() { return canvas.height; },

    // style
    color: (...args) => color(...args),
    background(...args) {
      if (args.length === 1 && args[0] && args[0].nodeType) { // an image
        try { ctx.drawImage(args[0], 0, 0, S.sketchW, S.sketchH); } catch (err) { /* not loaded yet */ }
        return;
      }
      const c = color(...args);
      ctx.save();
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.fillStyle = css(c);
      ctx.fillRect(0, 0, S.sketchW, S.sketchH);
      ctx.restore();
    },
    fill(...args) { S.fill = color(...args); S.doFill = true; },
    noFill() { S.doFill = false; },
    stroke(...args) { S.stroke = color(...args); S.doStroke = true; },
    noStroke() { S.doStroke = false; },
    strokeWeight(w) { S.weight = w; ctx.lineWidth = w; },
    strokeCap(c) { ctx.lineCap = capName(c); },
    strokeJoin(j) { ctx.lineJoin = joinName(j); },
    rectMode(m) { S.rectMode = m; },
    ellipseMode(m) { S.ellipseMode = m; },
    smooth() { ctx.imageSmoothingEnabled = true; },
    noSmooth() { ctx.imageSmoothingEnabled = false; },
    pushStyle() {
      ctx.save();
      S.styleStack.push({
        fill: S.fill.slice(), stroke: S.stroke.slice(), doFill: S.doFill, doStroke: S.doStroke,
        weight: S.weight, textSize: S.textSize, font: S.font, alignH: S.alignH, alignV: S.alignV,
      });
    },
    popStyle() {
      const st = S.styleStack.pop();
      if (st) {
        S.fill = st.fill; S.stroke = st.stroke; S.doFill = st.doFill; S.doStroke = st.doStroke;
        S.weight = st.weight; S.textSize = st.textSize; S.font = st.font; S.alignH = st.alignH; S.alignV = st.alignV;
      }
      ctx.restore();
    },
    push() { ctx.save(); API.pushStyle(); },
    pop() { API.popStyle(); ctx.restore(); },

    // shapes
    rect(x, y, w, h) {
      const r = rectCoords(x, y, w, h);
      ctx.beginPath();
      ctx.rect(r[0], r[1], r[2], r[3]);
      paint();
    },
    square(x, y, s) { API.rect(x, y, s, s); },
    ellipse(x, y, w, h) {
      const e = ellipseCoords(x, y, w, h);
      ctx.beginPath();
      ctx.ellipse(e[0], e[1], Math.abs(e[2]), Math.abs(e[3]), 0, 0, Math.PI * 2);
      paint();
    },
    circle(x, y, d) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.abs(d) / 2, Math.abs(d) / 2, 0, 0, Math.PI * 2);
      paint();
    },
    line(x1, y1, x2, y2) {
      if (!S.doStroke) return;
      ctx.strokeStyle = css(S.stroke);
      ctx.lineWidth = S.weight;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    point(x, y) {
      if (!S.doStroke) return;
      ctx.save();
      ctx.fillStyle = css(S.stroke);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, S.weight / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    triangle(x1, y1, x2, y2, x3, y3) {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
      paint();
    },
    quad(x1, y1, x2, y2, x3, y3, x4, y4) {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath();
      paint();
    },
    arc(x, y, w, h, start, stop) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, start, stop);
      paint();
    },
    beginShape(mode) { S.shape = []; S.shapeMode = mode || 0; },
    vertex(x, y) { if (S.shape) S.shape.push([x, y]); },
    endShape(close) {
      const pts = S.shape || [];
      S.shape = null;
      if (!pts.length) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (close) ctx.closePath();
      paint();
    },

    // text
    text(str, x, y) {
      const s = String(str);
      ctx.font = S.textSize + 'px ' + S.font;
      alignToCtx();
      if (S.doFill) { ctx.fillStyle = css(S.fill); ctx.fillText(s, x, y); }
      if (S.doStroke) { ctx.strokeStyle = css(S.stroke); ctx.lineWidth = S.weight; ctx.strokeText(s, x, y); }
    },
    textSize(s) { if (s === undefined) return S.textSize; S.textSize = s; },
    textLeading(l) { if (l === undefined) return S.textLeading; S.textLeading = l; },
    textFont(f) { if (f === undefined) return S.font; S.font = String(f); },
    textAlign(h, v) { if (h !== undefined) S.alignH = h; if (v !== undefined) S.alignV = v; },
    textWidth(s) { ctx.font = S.textSize + 'px ' + S.font; return ctx.measureText(String(s)).width; },
    textAscent() { ctx.font = S.textSize + 'px ' + S.font; return S.textSize * 0.8; },
    textDescent() { ctx.font = S.textSize + 'px ' + S.font; return S.textSize * 0.2; },

    // transforms
    pushMatrix() { ctx.save(); },
    popMatrix() { ctx.restore(); },
    translate(x, y) { ctx.translate(x, y || 0); },
    rotate(a) { ctx.rotate(a); },
    scale(x, y) { ctx.scale(x, y === undefined ? x : y); },
    resetMatrix() { ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); },

    // math
    map, constrain, dist, norm, lerp, lerpColor, radians, degrees, sq, mag,
    random, randomSeed, noise, noiseSeed, shuffle,
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
    min: Math.min, max: Math.max, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    exp: Math.exp, log: Math.log, sign: Math.sign, hypot: Math.hypot,

    // Приведение типов (в Java это casts)
    int: (v) => Math.trunc(Number(v)) | 0,
    float: (v) => Number(v),
    boolean: (v) => !!v,
    char: (v) => String(v).charAt(0),
    byte: (v) => Math.trunc(Number(v)),
    short: (v) => Math.trunc(Number(v)),
    long: (v) => Math.trunc(Number(v)),

    // Компоненты цвета
    red: (c) => color(c)[0],
    green: (c) => color(c)[1],
    blue: (c) => color(c)[2],
    alpha: (c) => (color(c)[3] === undefined ? 255 : color(c)[3]),
    hex: (r, g, b) => {
      if (g === undefined) {
        const v = color(r);
        return ('#' + v.slice(0, 3).map((n) => (n | 0).toString(16).padStart(2, '0')).join('')).toUpperCase();
      }
      return ('#' + [r, g, b].map((n) => (n | 0).toString(16).padStart(2, '0')).join('')).toUpperCase();
    },

    // time
    millis() { return Date.now() - S.started; },
    second() { return new Date().getSeconds(); },
    minute() { return new Date().getMinutes(); },
    hour() { return new Date().getHours(); },
    day() { return new Date().getDate(); },
    month() { return new Date().getMonth() + 1; },
    year() { return new Date().getFullYear(); },
    get frameCount() { return S.frame; },
    frameRate(fps) { if (fps === undefined) return S.fpsValue; S.targetFps = fps; return fps; },
    get currentFrameRate() { return S.fpsValue; },
    deltaTime() { return S.delta; },
    loop() { S.loop = true; },
    noLoop() { S.loop = false; },
    redraw() { drawFrame(); },
    exit() { S.dead = true; post({ type: 'stopped' }); },

    // sensors
    get accelerometerX() { return S.accelX; },
    get accelerometerY() { return S.accelY; },
    get accelerometerZ() { return S.accelZ; },
    get gyroscopeX() { return S.gyroX; },
    get gyroscopeY() { return S.gyroY; },
    get gyroscopeZ() { return S.gyroZ; },
    get magnetometerX() { return S.magX; },
    get magnetometerY() { return S.magY; },
    get magnetometerZ() { return S.magZ; },
    get rotation() { return S.rotation; },
    get orientation() { return S.orientation; },
    get heading() { return S.heading; },
    get latitude() { return S.lat; },
    get longitude() { return S.lon; },
    get altitude() { return S.alt; },
    get accuracy() { return S.accuracy; },

    // Android: активность, разрешения, настройки
    getActivity() { return ACTIVITY; },
    getContext() { return CONTEXT; },
    getPreferences() { return PREFS; },
    /**
     * requestPermission("android.permission.CAMERA") — вызовет onPermissionGranted(name, granted).
     * requestPermission("android.permission.CAMERA", "onCameraPermission") — вызовет метод с boolean.
     */
    requestPermission(permission, callback) {
      const name = String(permission);
      pendingPermissions.push({ name, callback: callback ? String(callback) : null });
      post({ type: 'permission-request', permission: name });
    },
    hasPermission(permission) { return !!S.permissions[String(permission)]; },
    getPackageName() { return opts.packageName || 'com.example.sketch'; },
    isPermissionGranted(permission) { return !!S.permissions[String(permission)]; },

    // Android Mode: ориентация, клавиатура, кнопка «Назад», lifecycle
    orientation(mode) {
      S.orientationLock = mode === undefined ? 0 : mode;
      post({ type: 'orientation', mode: S.orientationLock });
    },
    openKeyboard() {
      S.keyboard = true;
      post({ type: 'keyboard', open: true });
    },
    closeKeyboard() {
      S.keyboard = false;
      post({ type: 'keyboard', open: false });
    },
    /** Кнопка «Назад»: сначала sketch, потом выход из приложения. */
    onBackPressed() {
      const fn = W.backPressed;
      if (typeof fn === 'function') { try { fn(); return; } catch (err) { fail(err); return; } }
      ACTIVITY.finish();
    },
    /** Фоновый поток: в браузере это отдельная задача, а не настоящий поток. */
    thread(name) {
      const fn = W[name];
      if (typeof fn !== 'function') { post({ type: 'log', level: 'warn', text: `thread("${name}"): метод не найден` }); return; }
      setTimeout(() => { try { fn(); } catch (err) { fail(err); } }, 0);
    },
    /** Вызов в UI-потоке: в эмуляторе выполняется сразу. */
    runOnUiThread(fn) { try { if (typeof fn === 'function') fn(); } catch (err) { fail(err); } },

    // Числа и шрифты
    nf(value, left, right) {
      const v = Number(value) || 0;
      const l = left === undefined ? 0 : Math.max(0, Math.floor(left));
      const r = right === undefined ? 2 : Math.max(0, Math.floor(right));
      return v.toFixed(r).padStart(l + r + 1, '0');
    },
    createFont(name, size) { return { name: String(name || 'sans-serif'), size: Number(size) || 12, isLoaded: true }; },
    str: (v) => String(v),
    parseBool: (v) => (v === true || String(v).toLowerCase() === 'true'),

    // Данные проекта: data/ проекта и внутренняя папка приложения
    loadStrings(name) {
      const raw = S.dataFiles[name];
      if (raw === undefined) return null;
      return String(raw).split(/\r?\n/);
    },
    loadJSONObject(name) {
      const raw = S.dataFiles[name];
      if (raw === undefined) return null;
      try { return new JSONObject(JSON.parse(raw)); } catch (err) { return null; }
    },
    saveStrings(name, values) {
      S.dataFiles[name] = (values || []).map((v) => String(v)).join('\n');
      post({ type: 'save-data', name, data: S.dataFiles[name] });
    },
    saveJSONObject(name, obj) {
      S.dataFiles[name] = JSON.stringify(obj);
      post({ type: 'save-data', name, data: S.dataFiles[name] });
    },

    // input
    get mouseX() { return S.mouseX; },
    get mouseY() { return S.mouseY; },
    get pmouseX() { return S.pmouseX; },
    get pmouseY() { return S.pmouseY; },
    get mouseButton() { return S.mouseButton; },
    get mouseIsPressed() { return S.mouseDown; },
    get __mouseDown() { return S.mouseDown; },
    get touches() { return S.touches; },
    get touchCount() { return S.touches.length; },
    get key() { return makeChar(S.key); },
    get keyCode() { return S.keyCode; },
    get keyIsPressed() { return S.keyDown; },
    get pressed() { return S.keyDown; },
    get __keyDown() { return S.keyDown; },
  };

  API.JSONObject = JSONObject;
  API.JSONArray = JSONArray;

  // ── PVector ───────────────────────────────────────────────────────────────────────────────
  API.PVector = class PVector {
    constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
    set(x, y, z) {
      if (x && x.x !== undefined) { this.x = x.x; this.y = x.y; this.z = x.z; }
      else { this.x = x; this.y = y || 0; this.z = z || 0; }
      return this;
    }
    add(x, y, z) {
      if (x && x.x !== undefined) { this.x += x.x; this.y += x.y || 0; this.z += x.z || 0; }
      else { this.x += x || 0; this.y += y || 0; this.z += z || 0; }
      return this;
    }
    sub(x, y, z) {
      if (x && x.x !== undefined) { this.x -= x.x; this.y -= x.y || 0; this.z -= x.z || 0; }
      else { this.x -= x || 0; this.y -= y || 0; this.z -= z || 0; }
      return this;
    }
    mult(x, y, z) {
      if (x && x.x !== undefined) { this.x *= x.x; this.y *= x.y; this.z *= x.z; }
      else if (y === undefined) { this.x *= x; this.y *= x; this.z *= x; }
      else { this.x *= x; this.y *= y; this.z *= z || 0; }
      return this;
    }
    div(x, y, z) {
      if (x && x.x !== undefined) { this.x /= x.x; this.y /= x.y; this.z /= x.z; }
      else if (y === undefined) { this.x /= x; this.y /= x; this.z /= x; }
      else { this.x /= x; this.y /= y; this.z /= z || 0; }
      return this;
    }
    mag() { return Math.hypot(this.x, this.y, this.z); }
    magSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() { const m = this.mag(); if (m > 0) this.div(m); return this; }
    limit(max) { if (this.magSq() > max * max) this.normalize().mult(max); return this; }
    setMag(len) { return this.normalize().mult(len); }
    heading() { return Math.atan2(this.y, this.x); }
    rotate(a) {
      const c = Math.cos(a), s = Math.sin(a), x = this.x;
      this.x = x * c - this.y * s; this.y = x * s + this.y * c;
      return this;
    }
    dist(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - (v.z || 0)); }
    lerp(v, amt) {
      this.x += (v.x - this.x) * amt; this.y += (v.y - this.y) * amt; this.z += ((v.z || 0) - this.z) * amt;
      return this;
    }
    copy() { return new PVector(this.x, this.y, this.z); }
    array() { return [this.x, this.y, this.z]; }
    static fromAngle(angle, len) { len = len === undefined ? 1 : len; return new PVector(Math.cos(angle) * len, Math.sin(angle) * len, 0); }
    static fromAngleXYZ(x, y, z) { return new PVector(Math.cos(x) * Math.cos(y) * z, Math.sin(x) * Math.cos(y) * z, Math.sin(y) * z); }
    static random2D() { return PVector.fromAngle(randomGen() * Math.PI * 2); }
    static add(a, b) { return a.copy().add(b); }
    static sub(a, b) { return a.copy().sub(b); }
    static mult(v, s) { return v.copy().mult(s); }
    static dist(a, b) { return a.dist(b); }
    static lerp(a, b, amt) { return a.copy().lerp(b, amt); }
  };

  // ── Collections ───────────────────────────────────────────────────────────────────────────
  API.ArrayList = class ArrayList {
    constructor() { this.items = []; }
    add(v) { this.items.push(v); return true; }
    addAll(arr) { for (const v of arr) this.items.push(v); }
    get(i) { return this.items[i]; }
    set(i, v) { this.items[i] = v; }
    size() { return this.items.length; }
    isEmpty() { return this.items.length === 0; }
    contains(v) { return this.items.indexOf(v) >= 0; }
    remove(i) {
      if (typeof i === 'number') this.items.splice(i, 1);
      else { const k = this.items.indexOf(i); if (k >= 0) this.items.splice(k, 1); }
    }
    clear() { this.items.length = 0; }
    toArray() { return this.items.slice(); }
    [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  };

  API.HashMap = class HashMap {
    constructor() { this.map = new Map(); }
    put(k, v) { this.map.set(k, v); }
    get(k) { return this.map.has(k) ? this.map.get(k) : null; }
    containsKey(k) { return this.map.has(k); }
    remove(k) { this.map.delete(k); }
    size() { return this.map.size; }
    clear() { this.map.clear(); }
    keySet() { return Array.from(this.map.keys()); }
    values() { return Array.from(this.map.values()); }
  };

  // ── Output ────────────────────────────────────────────────────────────────────────────────
  const stringify = (v) => {
    if (typeof v === 'object' && v !== null) { try { return JSON.stringify(v); } catch (err) { return String(v); } }
    return String(v);
  };
  const log = (level, text) => post({ type: 'log', level, text: String(text) });

  API.println = (...args) => log('log', args.map(stringify).join(' '));
  API.print = (...args) => log('log', args.map(stringify).join(' '));
  API.format = (fmt, ...args) => {
    let i = 0;
    return String(fmt).replace(/%[sdif%]/g, (m) => {
      if (m === '%%') return '%';
      const v = args[i++];
      if (m === '%d') return String(Math.round(Number(v)));
      if (m === '%f') return String(Number(v));
      return stringify(v);
    });
  };

  const origLog = console.log ? console.log.bind(console) : null;
  console.log = (...args) => { if (origLog) origLog(...args); log('log', args.map(stringify).join(' ')); };
  console.error = (...args) => log('error', args.map(stringify).join(' '));
  console.warn = (...args) => log('warn', args.map(stringify).join(' '));

  // ── Images ────────────────────────────────────────────────────────────────────────────────
  const resolveUrl = (u) => {
    const s = String(u || '');
    if (/^(https?:|data:|blob:|file:)/i.test(s)) return s;
    const base = opts.baseDir || '';
    if (base) return 'file://' + base.replace(/\/+$/, '') + '/' + s.replace(/^\.\//, '');
    return s;
  };
  API.loadImage = (path, cb) => {
    const img = new Image();
    img.onload = () => { if (typeof cb === 'function') cb(img); };
    img.onerror = () => { log('warn', 'Не удалось загрузить изображение: ' + path); if (typeof cb === 'function') cb(null); };
    img.src = resolveUrl(path);
    S.images.set(path, img);
    return img;
  };
  API.imageMode = (mode) => { S.imageMode = mode; };
  API.image = (img, x, y, w, h) => {
    if (!img) return;
    const mode = S.imageMode;
    try {
      if (mode === 1) { // CORNERS
        const iw = img.width || 0, ih = img.height || 0;
        ctx.drawImage(img, x, y, w - x, h - y);
      } else if (mode === 3) { // CENTER
        const iw = (w === undefined ? (img.width || 0) : w) / 2;
        const ih = (h === undefined ? (img.height || 0) : h) / 2;
        ctx.drawImage(img, x - iw, y - ih, w === undefined ? (img.width || 0) : w, h === undefined ? (img.height || 0) : h);
      } else if (w === undefined) ctx.drawImage(img, x, y);
      else ctx.drawImage(img, x, y, w, h);
    } catch (err) { /* the image is not ready yet */ }
  };
  API.saveFrame = (name) => {
    try { post({ type: 'save', url: canvas.toDataURL('image/png'), name: name || 'frame.png' }); } catch (err) { /* the canvas is tainted */ }
  };

  // ── Frame loop ────────────────────────────────────────────────────────────────────────────
  const drawTouches = () => {
    if (!S.showTouches || !S.touches.length) return;
    ctx.save();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    for (const t of S.touches) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 18, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,0,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,180,0,0.9)';
      ctx.fill();
    }
    ctx.restore();
  };

  const drawFrame = () => {
    if (S.dead) return;
    const now = performance.now();
    S.delta = S.last ? now - S.last : 16;
    S.last = now;
    try {
      tickSensors();
      if (typeof W.draw === 'function') W.draw();
    } catch (err) {
      fail(err);
      return;
    }
    S.frame++;
    S.fpsFrames++;
    if (!S.fpsSince) S.fpsSince = now;
    if (now - S.fpsSince >= 500) {
      S.fpsValue = Math.round((S.fpsFrames * 1000) / (now - S.fpsSince));
      S.fpsFrames = 0;
      S.fpsSince = now;
      post({ type: 'fps', fps: S.fpsValue });
    }
    drawTouches();
  };

  const loopFn = () => {
    if (S.dead) return;
    if (S.loop) drawFrame();
    requestAnimationFrame(loopFn);
  };

  // ── Installation ─────────────────────────────────────────────────────────────────────────
  const SKIP = { install: 1, start: 1, state: 1, __report: 1, __state: 1 };

  const install = () => {
    for (const key in API) {
      if (SKIP[key]) continue;
      const desc = Object.getOwnPropertyDescriptor(API, key);
      if (desc && desc.get) {
        Object.defineProperty(W, key, { get: desc.get, configurable: true });
      } else if (typeof API[key] === 'function') {
        const isClass = API[key].prototype && API[key].prototype.constructor === API[key];
        W[key] = isClass ? API[key] : API[key].bind(API);
      } else {
        W[key] = API[key];
      }
    }
    applySize();
    // displayDensity/frameRate — и число, и функция: `56 * displayDensity` и `displayDensity()`.
    for (const key of ['displayDensity', 'frameRate']) {
      if (typeof W[key] === 'function') {
        W[key].valueOf = () => (key === 'displayDensity' ? S.dpr : S.fpsValue);
        W[key].toString = () => String(key === 'displayDensity' ? S.dpr : S.fpsValue);
      }
    }
    W.addEventListener('resize', fitCanvas);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    W.addEventListener('keydown', onKeyDown);
    W.addEventListener('keyup', onKeyUp);
    W.addEventListener('keypress', onKeyTyped);
    W.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.source !== HOST) return;
      if (d.type === 'sensor') {
        if (d.x !== undefined) S.accelX = d.x;
        if (d.y !== undefined) S.accelY = d.y;
        if (d.z !== undefined) S.accelZ = d.z;
        if (d.rotation !== undefined) S.rotation = d.rotation;
        if (d.orientation !== undefined) S.orientation = d.orientation;
        if (d.heading !== undefined) S.heading = d.heading;
        if (d.shake) callHandler('shake', d);
      } else if (d.type === 'permission-result') {
        S.permissions[String(d.permission)] = !!d.granted;
        const pending = pendingPermissions.find((p) => p.name === String(d.permission));
        if (pending && pending.callback) {
          const fn = W[pending.callback];
          if (typeof fn === 'function') { try { fn(!!d.granted); } catch (err) { fail(err); } }
        }
        callHandler('permissionGranted', String(d.permission), !!d.granted);
      } else if (d.type === 'location') {
        S.lat = d.lat ?? S.lat;
        S.lon = d.lon ?? S.lon;
        S.alt = d.alt ?? S.alt;
        S.accuracy = d.accuracy ?? S.accuracy;
        callHandler('locationChanged', S.lat, S.lon, S.alt, S.accuracy);
      } else if (d.type === 'lifecycle') {
        S.paused = d.paused === true;
        const fn = W[d.paused ? 'onPause' : 'onResume'];
        if (typeof fn === 'function') { try { fn(); } catch (err) { fail(err); } }
      } else if (d.type === 'back') {
        const fn = W.backPressed;
        if (typeof fn === 'function') { try { fn(); } catch (err) { fail(err); } }
        else post({ type: 'finish' });
      } else if (d.type === 'key') {
        if (d.action === 'down') onKeyDown(d);
        else if (d.action === 'up') onKeyUp(d);
        else callHandler('keyTyped', d);
      } else if (d.type === 'stop') {
        S.dead = true;
      }
    });
  };

  const start = () => {
    try {
      if (typeof W.setup === 'function') W.setup();
    } catch (err) {
      fail(err);
      return;
    }
    post({ type: 'ready' });
    S.last = performance.now();
    requestAnimationFrame(loopFn);
  };

  API.install = install;
  API.start = start;
  API.__report = fail;
  API.__state = S;

  return API;
}


// ── FrogeeCodeIDE integration ──
(function processingMobilePlugin() {
  const api = frogee;
  const bridge = window.electronAPI;
  const devices = {
    pixel: { label: 'Pixel · 393 × 851', width: 393, height: 851, dpr: 2.75 },
    galaxy: { label: 'Galaxy · 360 × 800', width: 360, height: 800, dpr: 3 },
    iphone: { label: 'iPhone · 390 × 844', width: 390, height: 844, dpr: 3 },
    tablet: { label: 'Планшет · 744 × 1133', width: 744, height: 1133, dpr: 2 },
  };
  let panel = null;
  let frame = null;
  let running = false;
  let landscape = false;
  let projectRoot = '';
  let currentSettings = null;
  const buildSessionId = `processing-mobile-${Math.random().toString(36).slice(2)}`;
  let buildOutputTail = '';

  api.addStyle(`
    .pm-panel{position:fixed;z-index:9500;right:16px;top:58px;bottom:16px;width:430px;min-width:340px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;color:var(--text-color,#e9edf5);background:var(--panel-bg,#1b1f28);border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:14px;box-shadow:0 18px 60px #0008;overflow:hidden;font:13px/1.4 system-ui,sans-serif}
    .pm-panel[hidden]{display:none}.pm-head,.pm-toolbar,.pm-build{display:flex;align-items:center;gap:7px;padding:10px 12px;border-bottom:1px solid #ffffff18}.pm-head strong{font-size:14px}.pm-spacer{flex:1}.pm-panel button,.pm-panel select,.pm-panel input{font:inherit}.pm-panel button{color:inherit;background:#ffffff12;border:1px solid #ffffff22;border-radius:7px;padding:6px 9px;cursor:pointer}.pm-panel button:hover{background:#ffffff22}.pm-panel button.pm-primary{background:var(--accent-color,#3574f0);color:#fff;border-color:transparent}.pm-panel select,.pm-panel input{color:inherit;background:#111722;border:1px solid #ffffff30;border-radius:6px;padding:5px;min-width:0}.pm-panel select{flex:1}.pm-panel .pm-close{font-size:18px;line-height:1;padding:4px 9px}.pm-stage{flex:1;min-height:120px;display:grid;place-items:center;overflow:auto;background:radial-gradient(circle at 50% 20%,#343b49,#171a22 70%);padding:16px}.pm-phone{position:relative;width:var(--pm-width);height:var(--pm-height);max-width:100%;max-height:100%;background:#050608;border:8px solid #090b10;border-radius:32px;box-shadow:0 15px 36px #0009;overflow:hidden;box-sizing:border-box}.pm-phone:before{content:'';position:absolute;z-index:2;top:5px;left:calc(50% - 25px);width:50px;height:7px;background:#10131a;border-radius:8px;pointer-events:none}.pm-phone iframe{width:100%;height:100%;border:0;background:#000}.pm-status{padding:5px 12px;color:#b6c4d7;border-top:1px solid #ffffff18;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pm-console{height:100px;min-height:40px;resize:vertical;overflow:auto;background:#0d121b;color:#c5d5ec;padding:8px 12px;font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap}.pm-console .error{color:#ff8a8a}.pm-console .warn{color:#f2cf80}.pm-settings{padding:8px 12px;border-top:1px solid #ffffff18;display:grid;grid-template-columns:1fr 1fr;gap:8px}.pm-settings[hidden]{display:none}.pm-settings label{display:flex;flex-direction:column;gap:3px}.pm-settings .pm-wide{grid-column:1/-1}.pm-settings .pm-inline{flex-direction:row;align-items:center}.pm-toolbar{flex-wrap:wrap}.pm-build{flex-wrap:wrap}.pm-sensors{display:flex;align-items:center;gap:6px;padding:6px 12px}.pm-sensors input{width:55px}
  `);

  const basename = (path) => String(path || '').split(/[\\/]/).pop();
  const dirname = (path) => String(path || '').replace(/[\\/][^\\/]*$/, '');
  const log = (message, level = '') => {
    if (!panel) return;
    const line = document.createElement('div');
    line.textContent = String(message);
    if (level) line.className = level;
    const consoleEl = panel.querySelector('.pm-console');
    consoleEl.append(line);
    while (consoleEl.childNodes.length > 150) consoleEl.firstChild.remove();
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };
  const status = (text) => { if (panel) panel.querySelector('.pm-status').textContent = text; };
  const post = (data) => frame?.contentWindow?.postMessage({ source: 'frogee-device-host', ...data }, '*');

  function mount() {
    if (panel) { panel.hidden = false; return; }
    panel = document.createElement('section');
    panel.className = 'pm-panel';
    panel.setAttribute('aria-label', 'Processing Mobile');
    panel.innerHTML = `
      <div class="pm-head"><strong>Processing Mobile</strong><span class="pm-spacer"></span><button type="button" data-action="settings" title="Настройки Android">⚙</button><button type="button" class="pm-close" data-action="close" title="Закрыть">×</button></div>
      <div class="pm-toolbar"><select data-field="device" aria-label="Устройство">${Object.entries(devices).map(([id,d]) => `<option value="${id}">${d.label}</option>`).join('')}</select><button type="button" data-action="rotate" title="Повернуть">↻</button><button type="button" class="pm-primary" data-action="run">▶ Скетч</button><button type="button" data-action="stop">■</button></div>
      <div class="pm-stage"><div class="pm-phone"><iframe title="Эмулятор Processing" sandbox="allow-scripts"></iframe></div></div>
      <div class="pm-sensors">Акселерометр <label>X <input data-sensor="x" type="number" step="0.1" value="0"></label><label>Y <input data-sensor="y" type="number" step="0.1" value="0"></label><label>Z <input data-sensor="z" type="number" step="0.1" value="9.81"></label></div>
      <div class="pm-build"><button type="button" data-action="export">Экспорт Android</button><button type="button" data-action="build">Собрать APK</button><button type="button" data-action="device-run">На телефоне</button></div>
      <div class="pm-settings" hidden><label>Имя приложения<input data-field="app-name"></label><label>Package name<input data-field="package" spellcheck="false"></label><label>Min SDK<input data-field="min-sdk" type="number" min="21" max="36"></label><label>Target SDK<input data-field="target-sdk" type="number" min="21" max="36"></label><label class="pm-inline pm-wide"><input data-field="adaptive" type="checkbox"> Adaptive UI</label><button type="button" class="pm-wide" data-action="save-settings">Сохранить настройки проекта</button></div>
      <div class="pm-status" role="status">Откройте .pde и запустите скетч</div><div class="pm-console" role="log" aria-label="Консоль скетча"></div>`;
    document.body.append(panel);
    frame = panel.querySelector('iframe');
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', (event) => {
      if (event.target.matches('[data-field="device"]')) applyDevice();
      if (event.target.matches('[data-sensor]')) sendSensors();
    });
    applyDevice();
  }

  function applyDevice() {
    if (!panel) return;
    const d = devices[panel.querySelector('[data-field="device"]').value] || devices.pixel;
    const stage = panel.querySelector('.pm-stage');
    const availableHeight = Math.max(180, stage.clientHeight - 32);
    const width = landscape ? d.height : d.width;
    const height = landscape ? d.width : d.height;
    const scale = Math.min(1, (stage.clientWidth - 32) / width, availableHeight / height);
    const phone = panel.querySelector('.pm-phone');
    phone.style.setProperty('--pm-width', `${Math.round(width * scale)}px`);
    phone.style.setProperty('--pm-height', `${Math.round(height * scale)}px`);
    if (running) post({ type: 'sensor', orientation: landscape ? 'landscape' : 'portrait', rotation: landscape ? 90 : 0 });
  }

  async function getSketch() {
    const active = api.editor.file();
    const selectedPath = active?.path && /\.pde$/i.test(active.name) ? active.path : null;
    const root = active?.path ? dirname(active.path) : null;
    if (!root) throw new Error('Откройте папку проекта или сохранённый файл .pde');
    const listing = await bridge.listFiles(root);
    if (!listing?.success) throw new Error(listing?.error || 'Не удалось прочитать папку проекта');
    const pdeFiles = listing.files.filter((file) => !file.isDirectory && /\.pde$/i.test(file.name));
    if (!pdeFiles.length) throw new Error('В папке проекта нет файлов .pde');
    const settings = await loadProject(root);
    const configured = settings?.sketch;
    const main = pdeFiles.find((file) => file.path === selectedPath)
      || pdeFiles.find((file) => file.name === configured)
      || pdeFiles.find((file) => file.name.toLowerCase() === `${basename(root).toLowerCase()}.pde`)
      || pdeFiles[0];
    const sources = [];
    for (const file of [main, ...pdeFiles.filter((item) => item.path !== main.path).sort((a,b) => a.name.localeCompare(b.name))]) {
      const result = await bridge.getFileContent(file.path);
      if (!result?.success) throw new Error(result?.error || `Не удалось прочитать ${file.name}`);
      sources.push({ name: file.name, path: file.path, code: file.path === selectedPath ? api.editor.get() : result.content });
    }
    projectRoot = root;
    currentSettings = settings || defaultSettingsFor(main.name);
    currentSettings.sketch = main.name;
    return { root, sources, settings: currentSettings };
  }

  async function dataFiles(root) {
    const out = {};
    const listed = await bridge.listFiles(joinPath(root, 'data'));
    if (!listed?.success) return out;
    for (const file of listed.files) {
      if (file.isDirectory) continue;
      const result = await bridge.getFileContent(file.path);
      if (result?.success) out[file.name] = result.content;
    }
    return out;
  }

  function frameHtml(code, options) {
    const runtime = createProcessingRuntime.toString();
    const source = JSON.stringify(`${code}\n//# sourceURL=sketch.pde\n`).replace(/<\//g, '<\\/');
    const opts = JSON.stringify(options).replace(/<\//g, '<\\/');
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}</style></head><body><script>window.__frogee=(${runtime})(${opts});window.__frogee.install();</script><script>try{(0,eval)(${source})}catch(e){window.__frogee.__report(e)}</script><script>window.__frogee.start();</script></body></html>`;
  }

  async function runSketch() {
    mount();
    const { root, sources, settings } = await getSketch();
    const code = sources.map((source) => transpileProcessing(source.code).code).join('\n');
    if (!code.trim()) throw new Error('Скетч пуст');
    const d = devices[panel.querySelector('[data-field="device"]').value] || devices.pixel;
    const options = { width: landscape ? d.height : d.width, height: landscape ? d.width : d.height,
      dpr: d.dpr, baseDir: root, packageName: settings.packageName, dataFiles: await dataFiles(root), showTouches: true };
    panel.querySelector('.pm-console').replaceChildren();
    buildOutputTail = '';
    frame.srcdoc = frameHtml(code, options);
    running = true;
    status(`Запущен ${sources[0].name} · ${options.width} × ${options.height}`);
    log(`Вкладки: ${sources.map((source) => source.name).join(', ')}`);
    sendSensors();
  }

  function stopSketch() {
    if (!running) return;
    post({ type: 'stop' });
    frame.srcdoc = '<!doctype html><html><body style="background:#000"></body></html>';
    running = false;
    status('Скетч остановлен');
  }

  function sendSensors() {
    if (!panel) return;
    const value = (axis) => Number(panel.querySelector(`[data-sensor="${axis}"]`).value) || 0;
    post({ type: 'sensor', x: value('x'), y: value('y'), z: value('z'), orientation: landscape ? 'landscape' : 'portrait' });
  }

  async function exportProject() {
    const { root, sources, settings } = await getSketch();
    if (!isValidPackageName(settings.packageName)) throw new Error('Некорректное package name в processing-studio.json');
    const existing = await bridge.listFiles(joinPath(root, 'android'));
    if (existing?.success && !window.confirm('Папка android уже существует. Обновить сгенерированные файлы?')) return null;
    const result = await exportAndroidProject({ root, sketchSource: sources, sketchName: sources[0].name, settings,
      runtime: { pApplet: PAPPLET_JAVA, pVector: PVECTOR_JAVA, pFont: PFONT_JAVA, json: JSONOBJECT_JAVA, adaptiveUi: ADAPTIVE_UI_JAVA } });
    if (!result.ok) throw new Error(result.error || 'Ошибка экспорта Android');
    status(`Android-проект: ${result.path}`);
    log(`Экспортирован ${result.path}`);
    return result.path;
  }

  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  function gradleCommand(runOnDevice, pkg) {
    if (/^Win/i.test(navigator.platform)) {
      const build = 'if (Test-Path gradle\\wrapper\\gradle-wrapper.jar) { .\\gradlew.bat assembleDebug } elseif (Get-Command gradle -ErrorAction SilentlyContinue) { gradle assembleDebug } else { Write-Error "Gradle не найден"; exit 1 }';
      return runOnDevice ? `${build}; if ($LASTEXITCODE -eq 0) { adb install -r app\\build\\outputs\\apk\\debug\\app-debug.apk; adb shell am start -n ${pkg}/.MainActivity }` : build;
    }
    const gradle = 'if [ -f gradle/wrapper/gradle-wrapper.jar ]; then sh ./gradlew assembleDebug; elif command -v gradle >/dev/null 2>&1; then gradle assembleDebug; elif [ -x "$HOME/Documents/ProcessingStudio/toolchain/gradle/bin/gradle" ]; then "$HOME/Documents/ProcessingStudio/toolchain/gradle/bin/gradle" assembleDebug; else echo "Gradle не найден: установите Gradle или Android Studio" >&2; false; fi';
    const env = 'if [ -z "$ANDROID_HOME" ]; then for sdk in "$HOME/Library/Android/sdk" "$HOME/Documents/Processing/android/sdk" "$HOME/Documents/ProcessingStudio/toolchain/android-sdk"; do if [ -d "$sdk/platforms" ]; then export ANDROID_HOME="$sdk"; break; fi; done; fi; if [ -n "$ANDROID_HOME" ]; then export PATH="$ANDROID_HOME/platform-tools:$PATH"; fi; if [ -z "$JAVA_HOME" ] && [ -x /usr/libexec/java_home ]; then export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"; fi';
    return runOnDevice ? `${env}; ${gradle} && adb install -r app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n ${quote(pkg + '/.MainActivity')}` : `${env}; ${gradle}`;
  }

  async function build(runOnDevice) {
    const androidDir = await exportProject();
    if (!androidDir) return;
    const activeTerminal = document.querySelector('#terminal-tab-list .terminal-tab.active')?.dataset.id;
    const started = await bridge.terminalStart({ id: buildSessionId, cwd: androidDir, cols: 100, rows: 24 });
    if (!started?.success) throw new Error(started?.error || 'Не удалось открыть терминал сборки');
    if (activeTerminal) await bridge.terminalActive(activeTerminal);
    panel.querySelector('.pm-console').replaceChildren();
    const command = gradleCommand(runOnDevice, currentSettings.packageName);
    const done = /^Win/i.test(navigator.platform)
      ? '; Write-Output "__PM_DONE_$LASTEXITCODE"'
      : '; printf "__PM_DONE_%s\\n" "$?"';
    const sent = await bridge.terminalWrite(`${command}${done}\r`, buildSessionId);
    if (!sent?.success) throw new Error(sent?.error || 'Не удалось запустить Gradle');
    status(runOnDevice ? 'Сборка и запуск на Android идут в консоли' : 'Сборка APK идёт в консоли');
  }

  function fillSettings() {
    if (!currentSettings || !panel) return;
    for (const [key, value] of Object.entries({ 'app-name': currentSettings.name, package: currentSettings.packageName, 'min-sdk': currentSettings.minSdk, 'target-sdk': currentSettings.targetSdk })) {
      panel.querySelector(`[data-field="${key}"]`).value = value;
    }
    panel.querySelector('[data-field="adaptive"]').checked = currentSettings.adaptiveUi !== false;
  }

  async function saveSettings() {
    await getSketch();
    const field = (name) => panel.querySelector(`[data-field="${name}"]`).value.trim();
    const next = { ...currentSettings, name: field('app-name') || 'Sketch', packageName: field('package'),
      minSdk: Number(field('min-sdk')), targetSdk: Number(field('target-sdk')),
      adaptiveUi: panel.querySelector('[data-field="adaptive"]').checked };
    if (!isValidPackageName(next.packageName)) throw new Error('Package name должен выглядеть как com.example.app');
    if (!Number.isInteger(next.minSdk) || !Number.isInteger(next.targetSdk) || next.minSdk < 21 || next.targetSdk < next.minSdk) throw new Error('Проверьте значения minSdk и targetSdk');
    if (!await saveProject(projectRoot, next)) throw new Error('Не удалось записать processing-studio.json');
    currentSettings = next;
    status('Настройки проекта сохранены');
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    try {
      switch (button.dataset.action) {
        case 'close': stopSketch(); panel.hidden = true; break;
        case 'run': await runSketch(); break;
        case 'stop': stopSketch(); break;
        case 'rotate': landscape = !landscape; applyDevice(); if (running) await runSketch(); break;
        case 'export': await exportProject(); break;
        case 'build': await build(false); break;
        case 'device-run': await build(true); break;
        case 'settings':
          await getSketch();
          fillSettings();
          panel.querySelector('.pm-settings').hidden = !panel.querySelector('.pm-settings').hidden;
          break;
        case 'save-settings': await saveSettings(); break;
      }
    } catch (error) {
      const message = error?.message || String(error);
      status(message);
      log(message, 'error');
      api.notify(message);
    }
  }

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.data?.source !== 'frogee-device') return;
    const data = event.data;
    if (data.type === 'log') log(data.text, data.level === 'error' ? 'error' : '');
    else if (data.type === 'error') { log(data.message || 'Ошибка скетча', 'error'); status(`Ошибка: ${data.message}`); running = false; }
    else if (data.type === 'fps') status(`Скетч запущен · ${data.fps} FPS`);
    else if (data.type === 'finish' || data.type === 'stopped') { running = false; status('Скетч завершён'); }
    else if (data.type === 'permission-request') {
      const granted = window.confirm(`Разрешить доступ к ${data.permission}?`);
      post({ type: 'permission-result', permission: data.permission, granted });
    } else if (data.type === 'save-data' && projectRoot && /^[^\\/]+$/.test(data.name || '')) {
      bridge.writeFile(joinPath(projectRoot, `data/${data.name}`), data.data ?? '');
    } else if (data.type === 'save' && data.url) {
      const link = document.createElement('a'); link.href = data.url; link.download = data.name || 'sketch.png'; link.click();
    } else if (data.type === 'orientation') {
      landscape = data.mode === 0 || data.mode === 8;
      applyDevice();
    }
  }

  window.addEventListener('message', onMessage);
  const offTerminalData = bridge.onTerminalData?.(({ id, data }) => {
    if (id !== buildSessionId) return;
    const plain = String(data || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    buildOutputTail = (buildOutputTail + plain).slice(-160);
    const done = /__PM_DONE_(\d+)/.exec(buildOutputTail);
    if (done) status(Number(done[1]) === 0 ? 'Сборка завершена успешно' : `Сборка завершилась с ошибкой (${done[1]})`);
    log(plain.replace(/__PM_DONE_\d+/, '').trimEnd());
  });
  const offTerminalExit = bridge.onTerminalExit?.(({ id, code }) => {
    if (id === buildSessionId) status(`Терминал сборки завершён (${code})`);
  });
  const onResize = () => applyDevice();
  window.addEventListener('resize', onResize);
  api.addButton({ title: 'Processing Mobile', icon: 'code', run: () => mount() });
  api.onUnload(() => {
    stopSketch();
    panel?.remove();
    panel = null;
    frame = null;
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', onResize);
    offTerminalData?.();
    offTerminalExit?.();
    bridge.terminalKill?.(buildSessionId);
  });
})();
