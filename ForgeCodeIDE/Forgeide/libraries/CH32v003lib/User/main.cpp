#include "Arduino.h"

constexpr uint8_t LED_PIN = PA2;
constexpr uint8_t AIN_PIN = PC4;

void setup() {
  Serial.begin(115200);

  pinMode(AIN_PIN, INPUT_ANALOG);
  pinMode(LED_PIN, OUTPUT_PWM);
}

void loop() {
  int16_t ain;

  ain = analogRead(AIN_PIN);
  Serial.print(ain);
  Serial.print("   \r");
  analogWrite(LED_PIN, ain);
  delay(50);
}
