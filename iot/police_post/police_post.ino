/*
  Inzira - Police Post (ESP32)  v2
  A fixed post at a junction. The officer turns the knob to choose how far along the road the report applies,
  then presses a button. The server finds the nearest road to POST_LAT/POST_LNG automatically.

    Potentiometer (GPIO34): length along the road, 100 m ... 2000 m
    Button MODERATE (GPIO18): congestion, level 2      Button HEAVY   (GPIO19): congestion, level 3
    Button BLOCKED  (GPIO23): road closed (60 min)     Button CLEAR   (GPIO25): cleared
    Green LED (GPIO2): success      Buzzer (GPIO5): failure
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ---------- CONFIG: edit these ----------
const char* WIFI_SSID  = "Wokwi-GUEST";
const char* WIFI_PASS  = "";
const char* API_BASE   = "https://YOUR-APP.onrender.com";
const char* DEVICE_KEY = "PASTE-KEY-FROM-ADMIN-TAB";    // portal -> Administration -> Register device (type: Police post)
const char* POST_NAME  = "Kimironko junction";
const double POST_LAT  = -1.9490;                       // where this post stands (right-click the map in Google/OSM)
const double POST_LNG  = 30.1250;
const char* ROAD_HINT  = "";                            // optional: part of a road name, e.g. "KG 11" to pick that road at a junction
const int   TTL_MIN    = 30;                            // how long a report stays valid
// -----------------------------------------

#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_POT 34
#define PIN_LED 2
#define PIN_BUZZER 5
const int BTN_PIN[4] = {18, 19, 23, 25};
const char* BTN_NAME[4] = {"MODERATE", "HEAVY", "BLOCKED", "CLEAR"};

Adafruit_SSD1306 oled(128, 64, &Wire, -1);
unsigned long lastPress[4] = {0, 0, 0, 0};
String status = "Ready", lastRoad = "";

int radiusM() {
  long sum = 0; for (int i = 0; i < 8; i++) sum += analogRead(PIN_POT);
  return constrain(map(sum / 8, 0, 4095, 1, 20), 1, 20) * 100;
}

void draw(int radius) {
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0); oled.print("Inzira Police Post");
  oled.drawLine(0, 9, 127, 9, SSD1306_WHITE);
  oled.setCursor(0, 13); oled.print(String(POST_NAME).substring(0, 21));
  oled.setCursor(0, 25); oled.printf("Length: %d m", radius);
  oled.setCursor(0, 37); oled.print(lastRoad.substring(0, 21));
  oled.setCursor(0, 52); oled.print(status.substring(0, 21));
  oled.display();
}

bool sendIncident(int button, int radius) {
  if (WiFi.status() != WL_CONNECTED) { status = "No WiFi"; return false; }
  String url = String(API_BASE) + "/api/incidents";
  WiFiClient plain; WiFiClientSecure tls; HTTPClient http;
  http.setTimeout(15000);
  bool ok = url.startsWith("https://") ? (tls.setInsecure(), http.begin(tls, url)) : http.begin(plain, url);
  if (!ok) { status = "HTTP begin fail"; return false; }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_KEY);
  StaticJsonDocument<400> d;
  d["lat"] = POST_LAT; d["lng"] = POST_LNG; d["radius_m"] = radius;
  if (strlen(ROAD_HINT) > 0) d["road"] = ROAD_HINT;
  d["minutes"] = TTL_MIN;
  d["note"] = String("Reported by ") + POST_NAME;
  if (button == 0) { d["type"] = "congestion"; d["level"] = 2; }
  if (button == 1) { d["type"] = "congestion"; d["level"] = 3; }
  if (button == 2) { d["type"] = "closure"; d["cause"] = "other"; d["minutes"] = 60; }
  if (button == 3) { d["type"] = "clear"; }
  String body; serializeJson(d, body);
  int c = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("incident %s r=%d -> %d %s\n", BTN_NAME[button], radius, c, resp.c_str());
  if (c == 201) {
    StaticJsonDocument<400> r;
    if (!deserializeJson(r, resp)) {
      lastRoad = String((const char*)(r["road"] | "road"));
      for (size_t i = 0; i < lastRoad.length(); i++) if ((uint8_t)lastRoad[i] > 126) lastRoad[i] = '-';   // OLED font is ASCII only
    }
    status = "Sent OK"; return true;
  }
  status = (c == 404) ? "No road near post" : (c == 401) ? "Bad device key" : "Error " + String(c);
  return false;
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) pinMode(BTN_PIN[i], INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  Wire.begin(PIN_SDA, PIN_SCL);
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  oled.clearDisplay(); oled.setCursor(0, 0); oled.print("Connecting WiFi..."); oled.display();
  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(250);
  status = WiFi.status() == WL_CONNECTED ? "WiFi OK" : "WiFi FAILED";
}

void loop() {
  int radius = radiusM();
  for (int i = 0; i < 4; i++) {
    if (digitalRead(BTN_PIN[i]) == LOW && millis() - lastPress[i] > 800) {
      lastPress[i] = millis();
      status = String("Sending ") + BTN_NAME[i]; draw(radius);
      if (sendIncident(i, radius)) { digitalWrite(PIN_LED, HIGH); delay(300); digitalWrite(PIN_LED, LOW); }
      else tone(PIN_BUZZER, 400, 400);
    }
  }
  draw(radius);
  delay(100);
}
