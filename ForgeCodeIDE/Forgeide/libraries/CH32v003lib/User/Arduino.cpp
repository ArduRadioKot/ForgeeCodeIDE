#include <ch32v00x.h>
#include <core_riscv.h>
#include "Arduino.h"

extern void setup();
extern void loop();

extern "C" {

volatile uint32_t __us = 0, __ms = 0;

#ifndef NO_INTR
isr_t __intrs[8] = { nullptr };
#endif

void SystemInit() {
  RCC->CTLR |= (uint32_t)0x00000001;
  RCC->CFGR0 &= (uint32_t)0xFCFF0000;
  RCC->CTLR &= (uint32_t)0xFEF6FFFF;
  RCC->CTLR &= (uint32_t)0xFFFBFFFF;
  RCC->CFGR0 &= (uint32_t)0xFFFEFFFF;
  RCC->INTR = 0x009F0000;

#if F_CPU == 48000000
  /* Flash 0 wait state */
  FLASH->ACTLR &= (uint32_t)~FLASH_ACTLR_LATENCY;
  FLASH->ACTLR |= (uint32_t)FLASH_ACTLR_LATENCY_1;

  /* HCLK = SYSCLK = APB1 */
//  RCC->CFGR0 |= (uint32_t)RCC_HPRE_DIV1;

  /* PLL configuration: PLLCLK = HSI * 2 = 48 MHz */
  RCC->CFGR0 &= (uint32_t)~RCC_PLLSRC;
//  RCC->CFGR0 |= (uint32_t)RCC_PLLSRC_HSI_Mul2;

  /* Enable PLL */
  RCC->CTLR |= RCC_PLLON;
  /* Wait till PLL is ready */
  while (! (RCC->CTLR & RCC_PLLRDY)) {}
  /* Select PLL as system clock source */
  RCC->CFGR0 &= (uint32_t)~RCC_SW;
  RCC->CFGR0 |= (uint32_t)RCC_SW_PLL;
  /* Wait till PLL is used as system clock source */
  while ((RCC->CFGR0 & (uint32_t)RCC_SWS) != (uint32_t)0x08) {}
#else
  #error "Unsupported CPU frequency!"
#endif
}

static void preinit() {
  NVIC_EnableIRQ(SysTick_IRQn);
  SysTick->CMP = F_CPU / 1000 - 1; // 1 kHz
  SysTick->CNT = 0;
  SysTick->SR = 0;
  SysTick->CTLR = 0x0F;

  RCC->APB1PCENR |= RCC_TIM2EN;

  NVIC_EnableIRQ(TIM2_IRQn);
  TIM2->CTLR1 = TIM_ARPE;
  TIM2->PSC = F_CPU / 1000000 - 1; // 1 MHz
  TIM2->CNT = 0;
  TIM2->ATRLR = PWM_MAX;
  TIM2->SWEVGR = TIM_UG;
  TIM2->INTFR = 0; // ~TIM_UIF
  TIM2->DMAINTENR |= TIM_UIE;
  TIM2->CTLR1 |= TIM_CEN;

  RCC->APB2PCENR |= (RCC_IOPAEN | RCC_IOPCEN | RCC_IOPDEN)
#ifndef NO_PWM
    | RCC_TIM1EN
#endif
#ifndef NO_ADC
    | RCC_ADC1EN
#endif
#if (! defined(NO_INTR)) || defined(NO_DEBUG) || (TIM1_REMAP != TIM1_REMAP_00) || (TIM2_REMAP != TIM2_REMAP_00) || (UART_REMAP != UART_REMAP_00) || (I2C_REMAP != I2C_REMAP_00) || (SPI_REMAP != SPI_REMAP_0)
    | RCC_AFIOEN
#endif
    ;

#ifdef NO_DEBUG
  AFIO->PCFR1 = 0x4000000 | TIM1_REMAP | TIM2_REMAP | UART_REMAP | I2C_REMAP | SPI_REMAP; // SWCFG = b'100
#elif (TIM1_REMAP != TIM1_REMAP_00) || (TIM2_REMAP != TIM2_REMAP_00) || (UART_REMAP != UART_REMAP_00) || (I2C_REMAP != I2C_REMAP_00) || (SPI_REMAP != SPI_REMAP_0)
  AFIO->PCFR1 = TIM1_REMAP | TIM2_REMAP | UART_REMAP | I2C_REMAP | SPI_REMAP;
#endif

#ifndef NO_PWM
  TIM1->CTLR1 = TIM_ARPE;
  TIM1->PSC = F_CPU / 1000000 - 1; // 1 MHz
  TIM1->CNT = 0;
  TIM1->ATRLR = PWM_MAX;
  TIM1->SWEVGR = TIM_UG;
  TIM1->RPTCR = 0;
  TIM1->BDTR |= TIM_MOE;
  TIM1->CTLR2 = TIM_OIS1N | TIM_OIS2N | TIM_OIS3N;
  TIM1->CCER = 0; // TIM_CC1NP | TIM_CC2NP | TIM_CC3NP;
  TIM1->CHCTLR1 = TIM_OC1M_1 | TIM_OC1M_2 | TIM_OC2M_1 | TIM_OC2M_2; // PWM1 mode
  TIM1->CHCTLR2 = TIM_OC3M_1 | TIM_OC3M_2 | TIM_OC4M_1 | TIM_OC4M_2; // PWM1 mode
  TIM1->CTLR1 |= TIM_CEN;

  TIM2->BDTR |= TIM_MOE;
  TIM2->CCER = 0;
  TIM2->CHCTLR1 = TIM_OC1M_1 | TIM_OC1M_2 | TIM_OC2M_1 | TIM_OC2M_2; // PWM1 mode
  TIM2->CHCTLR2 = TIM_OC3M_1 | TIM_OC3M_2 | TIM_OC4M_1 | TIM_OC4M_2; // PWM1 mode
#endif

#ifndef NO_ADC
  RCC->CFGR0 &= 0xFFFF07FF; // CFGR0_ADCPRE_Reset_Mask
  RCC->CFGR0 |= 0xC000; // RCC_PCLK2_Div8

  ADC1->CTLR1 &= 0xFFF0FEFF; // CTLR1_CLEAR_Mask
//  ADC1->CTLR1 |= 0; // ADC_Mode_Independent | (ADC_ScanConv_None << 8)
  ADC1->CTLR2 &= 0xFFF1F7FD; // CTLR2_CLEAR_Mask
  ADC1->CTLR2 |= 0xE0000; // ADC_DataAlign_Right | ADC_ExternalTrigConv_None | (ADC_ContinuousConv_None << 1)
  ADC1->RSQR1 &= 0xFF0FFFFF; // RSQR1_CLEAR_Mask
//  ADC1->RSQR1 |= 0 << 20;

  ADC1->CTLR1 &= ~(uint32_t)(3 << 25);
  ADC1->CTLR1 |= 0x2000000; // ADC_CALVOL_50PERCENT
  ADC1->CTLR2 |= 0x01; // CTLR2_ADON_Set
  ADC1->CTLR2 |= 0x08; // CTLR2_RSTCAL_Set
  while (ADC1->CTLR2 & 0x08) {} // CTLR2_RSTCAL_Set
  ADC1->CTLR2 |= 0x04; // CTLR2_CAL_Set
  while (ADC1->CTLR2 & 0x04) {} // CTLR2_CAL_Set
#endif
}

int main() {
  preinit();

  setup();
  while (1) {
    loop();
  }
}

static GPIO_TypeDef *gpioFromPin(uint8_t pin) {
  pin >>= 3;
  if (pin == 0)
    return GPIOA;
  if (pin == 2)
    return GPIOC;
  return GPIOD;
}

#ifndef NO_PWM
static TIM_TypeDef *timerFromPin(uint8_t *pin) {
#if (TIM1_REMAP == TIM1_REMAP_00) || (TIM1_REMAP == TIM1_REMAP_10)
  static const uint8_t TIM1_OUTPUTS[] = { PD2, PA1, PC3, PC4, PD0, PA2, PD1 };
#elif TIM1_REMAP == TIM1_REMAP_01
  static const uint8_t TIM1_OUTPUTS[] = { PC6, PC7, PC0, PD3, PC3, PC4, PD1 };
#elif TIM1_REMAP == TIM1_REMAP_11
  static const uint8_t TIM1_OUTPUTS[] = { PC4, PC7, PC5, PD4, PC3, PD2, PC6 };
#endif
#if TIM2_REMAP == TIM2_REMAP_00
  static const uint8_t TIM2_OUTPUTS[] = { PD4, PD3, PC0, PD7 };
#elif TIM2_REMAP == TIM2_REMAP_01
  static const uint8_t TIM2_OUTPUTS[] = { PC5, PC2, PD2, PC1 };
#elif TIM2_REMAP == TIM2_REMAP_10
  static const uint8_t TIM2_OUTPUTS[] = { PC1, PD3, PC0, PD7 };
#elif TIM2_REMAP == TIM2_REMAP_11
  static const uint8_t TIM2_OUTPUTS[] = { PC1, PC7, PD6, PD5 };
#endif

  for (uint8_t i = 0; i < sizeof(TIM1_OUTPUTS) / sizeof(TIM1_OUTPUTS[0]); ++i) {
    if (*pin == TIM1_OUTPUTS[i]) {
      *pin = i < 4 ? i + 1 : (uint8_t)(3 - i);
      return TIM1;
    }
  }
  for (uint8_t i = 0; i < sizeof(TIM2_OUTPUTS) / sizeof(TIM2_OUTPUTS[0]); ++i) {
    if (*pin == TIM2_OUTPUTS[i]) {
      *pin = i + 1;
      return TIM2;
    }
  }
  return (TIM_TypeDef*)0;
}
#endif

void pinMode(uint8_t pin, uint8_t mode) {
  GPIO_TypeDef *gpio;
#ifndef NO_PWM
  uint8_t _pin = pin;
#endif

  gpio = gpioFromPin(pin);
  pin &= 0x07;
  gpio->CFGLR &= ~(0x0F << (pin * 4));
  if (mode >= OUTPUT) {
    if (mode == OUTPUT)
      gpio->CFGLR |= (0x03 << (pin * 4));
    else if (mode == OUTPUT_OD)
      gpio->CFGLR |= (0x07 << (pin * 4));
#ifndef NO_PWM
    else { // mode == OUTPUT_PWM
      TIM_TypeDef *tim;

      tim = timerFromPin(&_pin);
      if (tim) {
        gpio->CFGLR |= (0x0B << (pin * 4));
        switch ((int8_t)_pin) {
          case -3:
            tim->CH3CVR = 0;
            tim->CCER |= TIM_CC3NE;
            break;
          case -2:
            tim->CH2CVR = 0;
            tim->CCER |= TIM_CC2NE;
            break;
          case -1:
            tim->CH1CVR = 0;
            tim->CCER |= TIM_CC1NE;
            break;
          case 1:
            tim->CH1CVR = 0;
            tim->CCER |= TIM_CC1E;
            break;
          case 2:
            tim->CH2CVR = 0;
            tim->CCER |= TIM_CC2E;
            break;
          case 3:
            tim->CH3CVR = 0;
            tim->CCER |= TIM_CC3E;
            break;
          case 4:
            tim->CH4CVR = 0;
            tim->CCER |= TIM_CC4E;
            break;
        }
      }
    }
#endif
  } else { // mode < OUTPUT
    if (mode == INPUT)
      gpio->CFGLR |= (0x04 << (pin * 4));
    else
#ifndef NO_ADC
    if (mode != INPUT_ANALOG) {
#else
    {
#endif
      gpio->CFGLR |= (0x08 << (pin * 4));
      if (mode == INPUT_PULLUP)
        gpio->BSHR = (1 << pin);
      else // mode == INPUT_PULLDOWN
        gpio->BCR = (1 << pin);
    }
  }
}

bool digitalRead(uint8_t pin) {
  GPIO_TypeDef *gpio;

  gpio = gpioFromPin(pin);
  pin &= 0x07;
  if (((gpio->CFGLR >> (pin * 4)) & 0x03) == 0) // INPUT
    return (gpio->INDR >> pin) & 0x01;
  else
    return (gpio->OUTDR >> pin) & 0x01;
}

void digitalWrite(uint8_t pin, bool level) {
  GPIO_TypeDef *gpio;

  gpio = gpioFromPin(pin);
  pin &= 0x07;
  if (level)
    gpio->BSHR = (1 << pin);
  else
    gpio->BCR = (1 << pin);
}

#ifndef NO_ADC
static int8_t adcFromPin(uint8_t pin) {
  static const uint8_t ADC_CHANNELS[] = { PA2, PA1, PC4, PD2, PD3, PD5, PD6, PD4 };

  for (int8_t i = 0; i < sizeof(ADC_CHANNELS) / sizeof(ADC_CHANNELS[0]); ++i) {
    if (ADC_CHANNELS[i] == pin)
      return i;
  }
  return -1;
}

int16_t analogRead(uint8_t pin) {
  if ((pin = adcFromPin(pin)) == (uint8_t)-1)
    return -1;

//  ADC1->SAMPTR2 &= ~(0x07 << (3 * pin));
  ADC1->SAMPTR2 |= 0x07 << (3 * pin); // ADC_SampleTime_241Cycles
  ADC1->RSQR3 &= ~0x1F;
  ADC1->RSQR3 |= pin;
  ADC1->CTLR2 |= 0x500000; // CTLR2_EXTTRIG_SWSTART_Set
  while (! (ADC1->STATR & 0x02)) {} // ADC_FLAG_EOC
  return ADC1->RDATAR;
}
#endif

#ifndef NO_PWM
void analogWrite(uint8_t pin, uint16_t value) {
  TIM_TypeDef *tim;

  tim = timerFromPin(&pin);
  if (tim) {
    value &= PWM_MAX;
    switch (abs((int8_t)pin)) {
      case 1:
        tim->CH1CVR = value;
        break;
      case 2:
        tim->CH2CVR = value;
        break;
      case 3:
        tim->CH3CVR = value;
        break;
      case 4:
        tim->CH4CVR = value;
        break;
    }
  }
}
#endif

#ifndef NO_INTR
void attachInterrupt(uint8_t pin, isr_t fn, uint8_t mode) {
  __intrs[pin & 0x07] = fn;
  AFIO->EXTICR &= ~(0x03 << ((pin & 0x07) * 2));
  AFIO->EXTICR |= (pin >> 3) << ((pin & 0x07) * 2);
  pin &= 0x07;
  if ((mode == RISING) || (mode == CHANGE))
    EXTI->RTENR |= (1 << pin);
  else
    EXTI->RTENR &= ~(1 << pin);
  if ((mode == FALLING) || (mode == CHANGE))
    EXTI->FTENR |= (1 << pin);
  else
    EXTI->FTENR &= ~(1 << pin);
  EXTI->INTENR |= (1 << pin);
  EXTI->EVENR |= (1 << pin);
  NVIC_SetPriority(EXTI7_0_IRQn, 6 << 4); // NVIC_PriorityGroup=2, NVIC_IRQChannelPreemptionPriority=1, NVIC_IRQChannelSubPriority=2
  NVIC_EnableIRQ(EXTI7_0_IRQn);
}

void detachInterrupt(uint8_t pin) {
  pin &= 0x07;
  if (__intrs[pin]) {
    __intrs[pin] = nullptr;
    EXTI->INTENR &= ~(1 << pin);
    EXTI->EVENR &= ~(1 << pin);
    for (uint8_t i = 0; i < 8; ++i) {
      if (__intrs[i])
        return;
    }
    NVIC_DisableIRQ(EXTI7_0_IRQn);
  }
}
#endif

uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder) {
  uint8_t result = 0;

  for (uint8_t i = 0; i < 8; ++i) {
    digitalWrite(clockPin, HIGH);
    if (bitOrder == LSBFIRST)
      result |= digitalRead(dataPin) << i;
    else
      result |= digitalRead(dataPin) << (7 - i);
    digitalWrite(clockPin, LOW);
  }
  return result;
}

void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value) {
  for (uint8_t i = 0; i < 8; ++i) {
    if (bitOrder == LSBFIRST) {
      digitalWrite(dataPin, value & 1);
      value >>= 1;
    } else {
      digitalWrite(dataPin, (value & 0x80) != 0);
      value <<= 1;
    }
    digitalWrite(clockPin, HIGH);
    digitalWrite(clockPin, LOW);
  }
}

uint32_t pulseIn(uint8_t pin, uint8_t state, uint32_t timeout) {
  GPIO_TypeDef *gpio;
  uint32_t start;

  gpio = gpioFromPin(pin);
  pin = 1 << (pin & 0x07);
  if (state)
    state = pin;
  timeout += (__us | TIM2->CNT);
  while ((gpio->INDR & pin) == state) {
    if ((int32_t)(__us | TIM2->CNT) >= (int32_t)timeout)
      return 0;
  }
  while ((gpio->INDR & pin) != state) {
    if ((int32_t)(__us | TIM2->CNT) >= (int32_t)timeout)
      return 0;
  }
  start = __us | TIM2->CNT;
  while ((gpio->INDR & pin) == state) {
    if ((int32_t)(__us | TIM2->CNT) >= (int32_t)timeout)
      return 0;
  }
  return (__us | TIM2->CNT) - start;
}

uint32_t micros() {
  return __us | TIM2->CNT;
}

void delayMicroseconds(uint32_t us) {
  us += (__us | TIM2->CNT);
  while ((int32_t)(__us | TIM2->CNT) < (int32_t)us) {
#ifndef NO_IDLE
    yield();
#endif
  }
}

void delay(uint32_t ms) {
  ms += __ms;
  while ((int32_t)__ms < (int32_t)ms) {
#ifndef NO_IDLE
    yield();
#endif
  }
}

long map(long x, long in_min, long in_max, long out_min, long out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

#ifndef NO_IDLE
void __attribute__((weak)) yield() {
  __WFI();
}
#endif

void __attribute__((interrupt("WCH-Interrupt-fast"))) NMI_Handler() {}

void __attribute__((interrupt("WCH-Interrupt-fast"))) HardFault_Handler() {
  while (1) {}
}

void __attribute__((interrupt("WCH-Interrupt-fast"))) SysTick_Handler() {
  ++__ms;
  SysTick->SR = 0;
}

void __attribute__((interrupt("WCH-Interrupt-fast"))) TIM2_IRQHandler() {
  if (TIM2->INTFR & TIM_UIF) {
    __us += PWM_MAX + 1;
    TIM2->INTFR = ~TIM_UIF;
  }
}

#ifndef NO_INTR
void __attribute__((interrupt)) EXTI7_0_IRQHandler() { // Not interrupt("WCH-Interrupt-fast")!!!
  uint32_t flags = EXTI->INTFR;

  for (uint8_t i = 0; i < 8; ++i) {
    if (__intrs[i] && (flags & (1 << i))) {
      __intrs[i]();
    }
  }
  EXTI->INTFR = flags;
}
#endif

} // extern "C" {
