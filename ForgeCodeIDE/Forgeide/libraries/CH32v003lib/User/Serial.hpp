#pragma once

#include "Print.hpp"

class UART : public Print {
public:
  void begin(uint32_t baud);
  void end();

  uint16_t write(char c);
  void flush();
};

extern UART Serial;
