#include <math.h>
#include "Print.hpp"

uint16_t Print::write(const char *buf, uint16_t count) {
  uint16_t result = 0;

  while (count--) {
    result += write(*buf++);
  }
  return result;
}

uint16_t Print::print(const char *str) {
  uint16_t result = 0;

  while (*str) {
    result += write(*str++);
  }
  return result;
}

uint16_t Print::print(uint32_t val, uint8_t base) {
  uint16_t result = 0;
  uint32_t divider = 1;

  if (base == HEX) {
    while ((divider < 0x10000000) && (divider * base <= val))
      divider *= base;
    while (divider) {
      uint8_t digit = (val / divider) % base;

      result += write(digit < 10 ? '0' + digit : 'A' + digit - 10);
      divider /= base;
    }
  } else {
    if (base == BIN) {
      while ((divider < 0x80000000) && (divider << 1 <= val))
        divider <<= 1;
    } else if (base == OCT) {
      while ((divider < 010000000000) && (divider * base <= val))
        divider *= base;
    } else { // base == DEC
      while ((divider < 1000000000) && (divider * base <= val))
        divider *= base;
    }
    while (divider) {
      result += write('0' + (val / divider) % base);
      divider /= base;
    }
  }
  return result;
}

uint16_t Print::print(int32_t val, uint8_t base) {
  uint16_t result = 0;

  if (val < 0) {
    result += write('-');
    result += print((uint32_t)-val, base);
  } else
    result += print((uint32_t)val, base);
  return result;
}

uint16_t Print::print(double val, uint8_t prec) {
  uint16_t result = 0;

  if (isnan(val))
    return print("nan");
  if (isinf(val))
    return print("inf");
  if (val > 4294967040.0)
    return print("ovf"); // constant determined empirically
  if (val < -4294967040.0)
    return print("-ovf"); // constant determined empirically

  // Handle negative numbers
  if (val < 0.0) {
    result += write('-');
    val = -val;
  }

  // Round correctly so that print(1.999, 2) prints as "2.00"
  {
    double rounding = 0.5;

    for (uint8_t i = 0; i < prec; ++i)
      rounding /= 10.0;
    val += rounding;
  }

  result += print((uint32_t)val);
  if (prec > 0) {
    result += write('.');
    val -= (uint32_t)val;
    while (prec--) {
      val *= 10.0;
      result += print((uint32_t)val);
      val -= (uint32_t)val;
    }
  }
  return result;
}

uint16_t Print::println(char c) {
  return print(c) + println();
}

uint16_t Print::println(const char *str) {
  return print(str) + println();
}

uint16_t Print::println(uint32_t val, uint8_t base) {
  return print(val, base) + println();
}

uint16_t Print::println(int32_t val, uint8_t base) {
  return print(val, base) + println();
}

uint16_t Print::println(double val, uint8_t prec) {
  return print(val, prec) + println();
}

const char Print::CRLF[] = "\r\n";
