/*
  Inzira - Vehicle Unit (ESP32)  v2
  - POSTs an anonymous probe (position + speed) every 5 s            -> /api/probes
  - GETs the fastest route every 15 s                                -> /api/route/lite
  - OLED: ETA, distance, fuel, next turn, alerts (4 languages)
  - Logs a finished trip (estimated vs actual time)                  -> /api/trips
  Button 1 (GPIO18): next destination     Button 2 (GPIO19): next language
  Buzzer (GPIO5) + LED (GPIO4): heavy traffic / roadworks warning

  USE_SIM_GPS 1 : simulated car that DRIVES ALONG THE REAL ROUTE returned by the server.
                  Potentiometer (GPIO34) = speed 0-60 km/h. Turn it down to make a jam appear on the map.
  USE_SIM_GPS 0 : real NEO-6M GPS on UART2 (RX2=16, TX2=17).
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

#define USE_SIM_GPS 1
#if !USE_SIM_GPS
  #include <TinyGPSPlus.h>
  TinyGPSPlus gps;
#endif

// ---------- CONFIG: edit these ----------
const char* WIFI_SSID  = "Wokwi-GUEST";                   // Wokwi's free WiFi (use your own on real hardware)
const char* WIFI_PASS  = "";
const char* API_BASE   = "https://YOUR-APP.onrender.com";  // no trailing slash. "localhost" does NOT work in Wokwi
const char* DEVICE_KEY = "PASTE-KEY-FROM-ADMIN-TAB";       // portal -> Administration -> Register device (type: Vehicle unit)
// -----------------------------------------

#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_BTN_DEST 18
#define PIN_BTN_LANG 19
#define PIN_BUZZER 5
#define PIN_LED 4
#define PIN_POT 34

Adafruit_SSD1306 oled(128, 64, &Wire, -1);

struct Dest { const char* name; double lat, lng; };
Dest DESTS[] = {{"Kimironko", -1.9490, 30.1250}, {"Kibagabaga", -1.9240, 30.1040}, {"Remera", -1.9570, 30.1080},
                {"City Centre", -1.9441, 30.0619}, {"Nyabugogo", -1.9395, 30.0445}};
const int N_DEST = 5;
int dest = 0;

const char* LANG_TAG[] = {"RW", "EN", "FR", "SW"};
int lang = 0;
const char* L_ETA[]  = {"Igihe", "ETA", "Duree", "Muda"};
const char* L_SAVE[] = {"Uzigama", "Saves", "Gain", "Okoa"};
const char* L_ARR[]  = {"Wageze!", "Arrived!", "Arrive!", "Umefika!"};
const char* L_TURN[4][4] = {{"Komeza", "Ibumoso", "Iburyo", "Subira"}, {"Straight", "Left", "Right", "U-turn"},
                            {"Tout droit", "Gauche", "Droite", "Demi-tour"}, {"Nyoosha", "Kushoto", "Kulia", "Rudi"}};
const char* L_ALERT[4][3] = {{"Imodoka nyinshi!", "Ubwubatsi!", "Nta kaburimbo"}, {"Heavy traffic!", "Roadworks!", "Unpaved road"},
                             {"Fort trafic!", "Travaux!", "Non goudronnee"}, {"Msongamano!", "Ujenzi!", "Si lami"}};
const char* L_WAIT[] = {"Tegereza...", "Waiting...", "Attente...", "Subiri..."};

// ---------- State ----------
double curLat = -1.9030, curLng = 30.0790, curSpeed = 0, curHeading = 0;   // start: Kagugu
bool routeOk = false, routeDirty = true, newTrip = true, arrived = false;
int etaMin = 0, savedMin = 0, nextM = 0, tripEstS = 0, tripDistM = 0;
float km = 0, fuelL = 0;
String roadName = "-", turnName = "straight", alertName = "none";
unsigned long tSim = 0, tProbe = 0, tRoute = 0, tScreen = 0, tBtn1 = 0, tBtn2 = 0, tripStartMs = 0, tArrived = 0;

// ---------- Geometry helpers ----------
struct P { double lat, lng; };
double havM(P a, P b) {
  double R = 6371000, r = M_PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  double h = sin(dLat / 2) * sin(dLat / 2) + cos(a.lat * r) * cos(b.lat * r) * sin(dLng / 2) * sin(dLng / 2);
  return 2 * R * asin(sqrt(h));
}
double brg(P a, P b) {
  double r = M_PI / 180, y = sin((b.lng - a.lng) * r) * cos(b.lat * r);
  double x = cos(a.lat * r) * sin(b.lat * r) - sin(a.lat * r) * cos(b.lat * r) * cos((b.lng - a.lng) * r);
  return fmod(atan2(y, x) / r + 360.0, 360.0);
}

// ---------- Simulated car: follows the server's route ----------
const double SIM_SCALE = 8.0;          // time acceleration so the car visibly moves
double pathLat[45], pathLng[45];
int pathN = 0, seg = 0;
double segProg = 0;

void simStep(double dt) {
  curSpeed = analogRead(PIN_POT) * 60.0 / 4095.0;
  if (pathN < 2 || arrived) return;
  segProg += curSpeed / 3.6 * dt * SIM_SCALE;
  double L = havM({pathLat[seg], pathLng[seg]}, {pathLat[seg + 1], pathLng[seg + 1]});
  while (segProg >= L) {
    segProg -= L; seg++;
    if (seg >= pathN - 1) { arrived = true; return; }
    L = havM({pathLat[seg], pathLng[seg]}, {pathLat[seg + 1], pathLng[seg + 1]});
  }
  double f = L > 0 ? segProg / L : 0;
  curLat = pathLat[seg] + (pathLat[seg + 1] - pathLat[seg]) * f;
  curLng = pathLng[seg] + (pathLng[seg + 1] - pathLng[seg]) * f;
  curHeading = brg({pathLat[seg], pathLng[seg]}, {pathLat[seg + 1], pathLng[seg + 1]});
}

// ---------- HTTP ----------
bool beginHttp(HTTPClient& http, WiFiClient& plain, WiFiClientSecure& tls, const String& url) {
  http.setTimeout(15000);                         // Render free tier can take ~30 s to wake up
  if (url.startsWith("https://")) { tls.setInsecure(); return http.begin(tls, url); }
  return http.begin(plain, url);
}
int postJson(const String& path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClient plain; WiFiClientSecure tls; HTTPClient http;
  if (!beginHttp(http, plain, tls, String(API_BASE) + path)) return -2;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_KEY);
  int code = http.POST(body);
  http.end();
  return code;
}

void postProbe() {
  StaticJsonDocument<200> d;
  d["lat"] = curLat; d["lng"] = curLng; d["speed_kmh"] = curSpeed; d["heading"] = curHeading;
  String body; serializeJson(d, body);
  int c = postJson("/api/probes", body);
  Serial.printf("probe -> %d (%.5f, %.5f, %.0f km/h)\n", c, curLat, curLng, curSpeed);
}

void postTrip() {
  double elapsed = (millis() - tripStartMs) / 1000.0;
#if USE_SIM_GPS
  elapsed *= SIM_SCALE;                            // convert accelerated sim time back to "real" seconds
#endif
  StaticJsonDocument<300> d;
  d["mode"] = "fastest"; d["estimated_s"] = tripEstS; d["actual_s"] = (int)elapsed; d["distance_m"] = tripDistM;
  d["from_label"] = "Unit"; d["to_label"] = DESTS[dest].name;
  String body; serializeJson(d, body);
  Serial.printf("trip -> %d (est %d s, actual %d s)\n", postJson("/api/trips", body), tripEstS, (int)elapsed);
}

bool fetchRoute() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient plain; WiFiClientSecure tls; HTTPClient http;
  String url = String(API_BASE) + "/api/route/lite?from_lat=" + String(curLat, 5) + "&from_lng=" + String(curLng, 5) +
               "&to_lat=" + String(DESTS[dest].lat, 5) + "&to_lng=" + String(DESTS[dest].lng, 5) + "&pts=1";
  if (!beginHttp(http, plain, tls, url)) return false;
  int code = http.GET();
  if (code != 200) { Serial.printf("route -> %d\n", code); http.end(); return false; }
  DynamicJsonDocument d(4096);
  DeserializationError err = deserializeJson(d, http.getString());
  http.end();
  if (err) { Serial.println(err.c_str()); return false; }
  etaMin = d["eta_min"]; km = d["km"]; fuelL = d["fuel_l"]; savedMin = d["saved_min"]; nextM = d["next_m"];
  roadName = String((const char*)d["road"]); turnName = String((const char*)d["turn"]); alertName = String((const char*)d["alert"]);
  if (newTrip) { tripEstS = d["eta_s"]; tripDistM = d["dist_m"]; tripStartMs = millis(); newTrip = false; arrived = false; }
#if USE_SIM_GPS
  JsonArray pts = d["pts"];
  pathN = min((int)(pts.size() / 2), 45);
  for (int i = 0; i < pathN; i++) { pathLat[i] = pts[2 * i]; pathLng[i] = pts[2 * i + 1]; }
  seg = 0; segProg = 0;
#endif
  Serial.printf("route -> ETA %d min, %.1f km, alert=%s\n", etaMin, km, alertName.c_str());
  return true;
}

// ---------- UI ----------
int alertIndex() { return alertName == "heavy_traffic" ? 0 : alertName == "construction" ? 1 : alertName == "unpaved" ? 2 : -1; }
int turnIndex() { return turnName == "left" ? 1 : turnName == "right" ? 2 : turnName == "uturn" ? 3 : 0; }

void draw() {
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);  oled.printf("Inzira [%s]  %2.0fkm/h", LANG_TAG[lang], curSpeed);
  oled.drawLine(0, 9, 127, 9, SSD1306_WHITE);
  oled.setCursor(0, 12); oled.printf("> %s", DESTS[dest].name);
  if (arrived) { oled.setTextSize(2); oled.setCursor(0, 32); oled.print(L_ARR[lang]); }
  else if (!routeOk) { oled.setCursor(0, 30); oled.print(L_WAIT[lang]); }
  else {
    oled.setCursor(0, 24); oled.printf("%s %d min  %.1f km", L_ETA[lang], etaMin, km);
    oled.setCursor(0, 34); oled.printf("%.2f L  %s %d min", fuelL, L_SAVE[lang], savedMin);
    oled.setCursor(0, 44); oled.printf("%s %dm", L_TURN[lang][turnIndex()], nextM);
    oled.setCursor(0, 54);
    if (alertIndex() >= 0) oled.print(L_ALERT[lang][alertIndex()]); else oled.print(roadName.substring(0, 21));
  }
  oled.display();
}

void alertOutputs() {
  static int lastA = -2;
  int a = routeOk && !arrived ? alertIndex() : -1;
  digitalWrite(PIN_LED, (a == 0 || a == 1) ? HIGH : LOW);
  if ((a == 0 || a == 1) && a != lastA) tone(PIN_BUZZER, 1000, 250);
  lastA = a;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN_DEST, INPUT_PULLUP); pinMode(PIN_BTN_LANG, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  Wire.begin(PIN_SDA, PIN_SCL);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("OLED not found");
#if !USE_SIM_GPS
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
#endif
  oled.clearDisplay(); oled.setCursor(0, 0); oled.print("Connecting WiFi..."); oled.display();
  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(250);
  Serial.println(WiFi.status() == WL_CONNECTED ? "WiFi connected" : "WiFi FAILED");
}

void loop() {
  unsigned long now = millis();
  if (digitalRead(PIN_BTN_DEST) == LOW && now - tBtn1 > 250) { tBtn1 = now; dest = (dest + 1) % N_DEST; routeOk = false; routeDirty = true; newTrip = true; arrived = false; pathN = 0; }
  if (digitalRead(PIN_BTN_LANG) == LOW && now - tBtn2 > 250) { tBtn2 = now; lang = (lang + 1) % 4; }

#if USE_SIM_GPS
  if (now - tSim >= 1000) { simStep((now - tSim) / 1000.0); tSim = now; }
#else
  while (Serial2.available()) gps.encode(Serial2.read());
  if (gps.location.isValid()) {
    curLat = gps.location.lat(); curLng = gps.location.lng(); curSpeed = gps.speed.kmph(); curHeading = gps.course.deg();
    if (!arrived && !newTrip && havM({curLat, curLng}, {DESTS[dest].lat, DESTS[dest].lng}) < 60) arrived = true;
  }
#endif

  if (arrived && tArrived == 0) { tArrived = now; postTrip(); }
  if (arrived && now - tArrived > 8000) {              // show "Arrived!" 8 s, then drive to the next destination
    dest = (dest + 1) % N_DEST; tArrived = 0; arrived = false; newTrip = true; routeDirty = true; pathN = 0;
  }

  if (WiFi.status() != WL_CONNECTED && now % 10000 < 50) WiFi.reconnect();
  if (now - tProbe >= 5000) { tProbe = now; postProbe(); }
  if (!arrived && (routeDirty || now - tRoute >= 15000)) { tRoute = now; routeDirty = false; routeOk = fetchRoute(); }
  if (now - tScreen >= 500) { tScreen = now; draw(); alertOutputs(); }
}
