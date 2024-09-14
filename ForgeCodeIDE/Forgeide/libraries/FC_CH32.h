//its liblary for ch32v003
#include "ch32v00x.h"



// GPIO_InitTypeDef GPIO_InitStruct = {0};
// GPIO_InitStruct.Pin = GPIO_PIN_13;
// GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
// GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
// GPIO_InitStruct.Pull = GPIO_NOPULL;
// HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);


void pinMode(uint32_t pin, uint8_t mode) {
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  GPIO_InitStruct.Pin = pin;

  if (mode == OUTPUT) {
    GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
  } else if (mode == INPUT) {
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
  } else if (mode == INPUT_PULLUP) {
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
  } else if (mode == INPUT_PULLDOWN) {
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  }

  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}
/** delay function for CH32V003 microcontroller */
void delay(uint32_t delay_ms) {
    uint32_t delay_ticks = delay_ms * (SystemCoreClock / 1000); // convert delay to ticks
    SysTick_Delay(delay_ticks); // use SysTick timer to generate delay
 }

 void map(long value, long fromLow, long fromHigh, long toLow, long toHigh) {
  return (value - fromLow) * (toHigh - toLow) / (fromHigh - fromLow) + toLow;
}

void digitalWrite(uint32_t pin, uint8_t value) {
  if (value == 0) {
    GPIO_ResetBits(GPIOB, pin);
  } else {
    GPIO_SetBits(GPIOB, pin);
  }
}

int digitalRead(uint32_t pin) {
  return HAL_GPIO_ReadPin(GPIOB, pin) ? 1 : 0;
}

void analogRead(uint32_t channel) {
  ADC_ChannelConfTypeDef sConfig = {0};

  sConfig.Channel = channel;
  sConfig.Rank = ADC_REGULAR_RANK_1;
  sConfig.SamplingTime = ADC_SAMPLETIME_3CYCLES;

  if (HAL_ADC_ConfigChannel(&hadc1, &sConfig) != HAL_OK) {
    Error_Handler();
  }

  if (HAL_ADC_Start(&hadc1) != HAL_OK) {
    Error_Handler();
  }

  if (HAL_ADC_PollForConversion(&hadc1, HAL_MAX_DELAY) != HAL_OK) {
    Error_Handler();
  }

  return HAL_ADC_GetValue(&hadc1);
}

void analogWrite(uint32_t pin, uint32_t value) {
  TIM_OC_InitTypeDef sConfigOC = {0};

  sConfigOC.OCMode = TIM_OCMODE_PWM1;
  sConfigOC.Pulse = value;
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;

  if (pin == GPIO_PIN_0) {
    HAL_TIM_PWM_ConfigChannel(&htim1, &sConfigOC, TIM_CHANNEL_1);
  } else if (pin == GPIO_PIN_1) {
    HAL_TIM_PWM_ConfigChannel(&htim1, &sConfigOC, TIM_CHANNEL_2);
  } else if (pin == GPIO_PIN_2) {
    HAL_TIM_PWM_ConfigChannel(&htim1, &sConfigOC, TIM_CHANNEL_3);
  } else if (pin == GPIO_PIN_3) {
    HAL_TIM_PWM_ConfigChannel(&htim1, &sConfigOC, TIM_CHANNEL_4);
  } else {
    Error_Handler();
  }

  if (HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1) != HAL_OK) {
    Error_Handler();
  }
}
void digitalBlink(uint32_t pin, uint32_t delayms )
{
  digitalWrite(pin, HIHG);
  delay(delayms);
  digitalWrite(pin, LOW);
  delay(delayms);
}
/** delay function for CH32V003 microcontroller */
// void delay(uint32_t delay_ms) {
//     volatile uint32_t start_time = SysTick_GetValue(); // get current SysTick value
//     uint32_t delay_ticks = delay_ms * (SystemCoreClock / 1000); // convert delay to ticks
//     while ((SysTick_GetValue() - start_time) < delay_ticks) {
        
//     }
// }

// /** delay function for CH32V003 microcontroller */
// void delay(uint32_t delay_ms) {
//     uint32_t start_time = get_tick_count(); // get current tick count
//     while ((get_tick_count() - start_time) < delay_ms) {
//     }
// }
int main(){
        launch();
    while(1){
        endless_loop();
    }
    
}