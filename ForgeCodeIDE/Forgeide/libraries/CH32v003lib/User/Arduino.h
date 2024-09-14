#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "binary.h"
#include "config.h"

#ifdef __cplusplus
#ifndef NO_SERIAL
  #include "Serial.h"
#endif

extern "C" {
#endif

enum { PA1 = 0x01, PA2 = 0x02,
  PC0 = 0x10, PC1 = 0x11, PC2 = 0x12, PC3 = 0x13, PC4 = 0x14, PC5 = 0x15, PC6 = 0x16, PC7 = 0x17,
  PD0 = 0x18, PD1 = 0x19, PD2 = 0x1A, PD3 = 0x1B, PD4 = 0x1C, PD5 = 0x1D, PD6 = 0x1E, PD7 = 0x1F
};
enum { INPUT, INPUT_PULLUP, INPUT_PULLDOWN
#ifndef NO_ADC
  , INPUT_ANALOG
#endif
  , OUTPUT, OUTPUT_OD
#ifndef NO_PWM
  , OUTPUT_PWM
#endif
};
enum { LOW = 0, HIGH = 1 };
enum { LSBFIRST, MSBFIRST };

#ifndef NO_INTR
enum { RISING, FALLING, CHANGE };

typedef void (*isr_t)();
#endif

extern volatile uint32_t __us, __ms;

#define min(a,b)    ((a)<(b)?(a):(b))
#define max(a,b)    ((a)>(b)?(a):(b))
#define abs(x)      ((x)<0?-(x):(x))
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#define round(x)    ((x)>=0?(long)((x)+0.5):(long)((x)-0.5))

void pinMode(uint8_t pin, uint8_t mode);
bool digitalRead(uint8_t pin);
void digitalWrite(uint8_t pin, bool level);
#ifndef NO_ADC
int16_t analogRead(uint8_t pin);
#endif
#ifndef NO_PWM
void analogWrite(uint8_t pin, uint16_t value);
#endif

#ifndef NO_INTR
void attachInterrupt(uint8_t pin, isr_t fn, uint8_t mode);
void detachInterrupt(uint8_t pin);
#endif

uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder);
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value);
uint32_t pulseIn(uint8_t pin, uint8_t state, uint32_t timeout);

uint32_t micros();

inline uint32_t millis() {
  return __ms;
}

void delayMicroseconds(uint32_t us);
void delay(uint32_t ms);

long map(long x, long in_min, long in_max, long out_min, long out_max);

#ifndef NO_IDLE
void __attribute__((weak)) yield();
#endif

#ifdef __cplusplus
}
#endif
