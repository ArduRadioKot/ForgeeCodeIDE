#pragma once

#define CH32V003J4
//#define CH32V003A4
//#define CH32V003F4

#if (! defined(CH32V003J4)) && (! defined(CH32V003A4)) && (! defined(CH32V003F4))
  #error "Undefined CH32V003x MCU!"
#endif
#if (defined(CH32V003J4) && (defined(CH32V003A4) || defined(CH32V003F4))) || \
  (defined(CH32V003A4) && (defined(CH32V003J4) || defined(CH32V003F4))) || \
  (defined(CH32V003F4) && (defined(CH32V003J4) || defined(CH32V003A4)))
  #error "Multiple CH32V003x MCU defined!"
#endif

#define F_CPU   48000000
//#define F_CPU   24000000
//#define F_CPU   8000000

#ifndef F_CPU
  #error "Undefined CH32V003x MCU frequency!"
#endif

#define PWM_MAX 1023 // 10 bit

#define TIM1_REMAP_00   0x00 // ETR=PC5, BRK=PC2, CH1=PD2, CH2=PA1, CH3=PC3, CH4=PC4, CH1N=PD0, CH2N=PA2, CH3N=PD1
#define TIM1_REMAP_01   0x40 // ETR=PC5, BRK=PC1, CH1=PC6, CH2=PC7, CH3=PC0, CH4=PD3, CH1N=PC3, CH2N=PC4, CH3N=PD1
#define TIM1_REMAP_10   0x80 // ETR=PD4, BRK=PC2, CH1=PD2, CH2=PA1, CH3=PC3, CH4=PC4, CH1N=PD0, CH2N=PA2, CH3N=PD1
#define TIM1_REMAP_11   0xC0 // ETR=PC2, BRK=PC1, CH1=PC4, CH2=PC7, CH3=PC5, CH4=PD4, CH1N=PC3, CH2N=PD2, CH3N=PC6

#define TIM2_REMAP_00   0x00 // CH1=PD4, CH2=PD3, CH3=PC0, CH4=PD7
#define TIM2_REMAP_01   0x100 // CH1=PC5, CH2=PC2, CH3=PD2, CH4=PC1
#define TIM2_REMAP_10   0x200 // CH1=PC1, CH2=PD3, CH3=PC0, CH4=PD7
#define TIM2_REMAP_11   0x300 // CH1=PC1, CH2=PC7, CH3=PD6, CH4=PD5

#define UART_REMAP_00   0x00 // TX=PD5, RX=PD6
#define UART_REMAP_01   0x04 // TX=PD0, RX=PD1
#define UART_REMAP_10   0x200000 // TX=PD6, RX=PD5
#define UART_REMAP_11   0x200004 // TX=PC0, RX=PC1

#define I2C_REMAP_00    0x00 // SCL=PC2, SDA=PC1
#define I2C_REMAP_01    0x02 // SCL=PD1, SDA=PD0
#define I2C_REMAP_10    0x400000 // SCL=PC5, SDA=PC6

#define SPI_REMAP_0     0x00 // SS=PC1, SCK=PC5, MISO=PC7, MOSI=PC6
#define SPI_REMAP_1     0x01 // SS=PC0, SCK=PC5, MISO=PC7, MOSI=PC6

#define TIM1_REMAP  TIM1_REMAP_00
#ifdef CH32V003J4
#define TIM2_REMAP  TIM2_REMAP_11
#else
#define TIM2_REMAP  TIM2_REMAP_00
#endif
#ifdef CH32V003J4
#define UART_REMAP  UART_REMAP_10
#else
#define UART_REMAP  UART_REMAP_00
#endif
#define I2C_REMAP   I2C_REMAP_00
#define SPI_REMAP   SPI_REMAP_0

#define NO_IDLE /* PROMLEM!!! Comment to use yield() in delayMicroseconds() */
#define NO_INTR /* Comment to use attachInterrupt() */
//#define NO_DEBUG /* Comment to use PD1 as SWIO */
//#define NO_SERIAL /* Comment to use Serial output */
//#define NO_PWM /* Comment to use analogWrite() */
//#define NO_ADC /* Comment to use analogRead() */
