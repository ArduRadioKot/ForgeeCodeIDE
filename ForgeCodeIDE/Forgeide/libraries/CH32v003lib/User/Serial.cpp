#include <ch32v00x.h>
#include "Serial.hpp"
#include "config.h"

void UART::begin(uint32_t baud) {
  uint32_t tmp, brr;

  RCC->APB2PCENR |= RCC_USART1EN;
#if UART_REMAP == UART_REMAP_00 // TX=PD5
  tmp = GPIOD->CFGLR;
  tmp &= ~(uint32_t)(0x0F << 5 * 4);
  tmp |= (uint32_t)(0x0B << 5 * 4); // PD5 = Output 50 MHz AF_PP
  GPIOD->CFGLR = tmp;
#elif UART_REMAP == UART_REMAP_01 // TX=PD0
  tmp = GPIOD->CFGLR;
  tmp &= ~(uint32_t)(0x0F << 0 * 4);
  tmp |= (uint32_t)(0x0B << 0 * 4); // PD0 = Output 50 MHz AF_PP
  GPIOD->CFGLR = tmp;
#elif UART_REMAP == UART_REMAP_10 // TX=PD6
  tmp = GPIOD->CFGLR;
  tmp &= ~(uint32_t)(0x0F << 6 * 4);
  tmp |= (uint32_t)(0x0B << 6 * 4); // PD6 = Output 50 MHz AF_PP
  GPIOD->CFGLR = tmp;
#elif UART_REMAP == UART_REMAP_11 // TX=PC0
  tmp = GPIOC->CFGLR;
  tmp &= ~(uint32_t)(0x0F << 0 * 4);
  tmp |= (uint32_t)(0x0B << 0 * 4); // PC0 = Output 50 MHz AF_PP
  GPIOC->CFGLR = tmp;
#endif

  tmp = (25 * F_CPU) / (4 * baud);
  brr = (tmp / 100) << 4;
  tmp -= 100 * (brr >> 4);
  brr |= (((tmp * 16) + 50) / 100) & 0x0F;
  USART1->BRR = brr;
  USART1->CTLR1 = USART_CTLR1_UE | USART_CTLR1_TE;
  USART1->CTLR2 = 0;
  USART1->CTLR3 = 0;
}

void UART::end() {
  USART1->CTLR1 &= ~USART_CTLR1_UE;
  RCC->APB2PCENR &= ~RCC_USART1EN;
}

uint16_t UART::write(char c) {
  USART1->DATAR = c;
  while (! (USART1->STATR & USART_STATR_TXE)) {}
  return sizeof(c);
}

void UART::flush() {
  while (! (USART1->STATR & USART_STATR_TC)) {}
}

UART Serial;
