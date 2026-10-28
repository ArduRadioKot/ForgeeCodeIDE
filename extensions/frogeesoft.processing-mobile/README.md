# Processing Mobile для FrogeeCodeIDE

Плагин запускает скетчи `.pde` в экранном эмуляторе Processing Studio, экспортирует
нативный Android-проект и запускает сборку APK во встроенной консоли плагина.

## Установка

В FrogeeCodeIDE откройте **Расширения → + → Установить из папки** и выберите
эту папку `extensions/processing-mobile`. Появится кнопка **Processing Mobile**
на левой панели. Можно установить и один файл `plugin.js` через
**Настройки → Плагины → Установить…**.

## Работа

1. Откройте сохранённый `.pde` в папке проекта Processing Studio.
2. Откройте сохранённый `.pde` и нажмите **Processing Mobile → Скетч**. Все `.pde` в его папке участвуют в запуске.
3. Выберите модель экрана, поверните её или измените значения акселерометра.
4. **Экспорт Android** создаёт или обновляет папку `android/` рядом со скетчем.
5. **Собрать APK** выполняет `assembleDebug` во встроенной консоли плагина; результат появится в
   `android/app/build/outputs/apk/debug/app-debug.apk`.
6. **На телефоне** после сборки вызывает `adb install` и запускает `MainActivity`.

Кнопка ⚙ открывает настройки имени, package name, SDK и Adaptive UI. Они хранятся
в `processing-studio.json` и совместимы с Processing Studio.

Для сборки нужны JDK 17, Android SDK и Gradle. Плагин ищет Gradle Wrapper, затем
`gradle` в `PATH`, затем установленный Processing Studio Gradle в
`~/Documents/ProcessingStudio/toolchain/gradle/bin/gradle`. На macOS Android SDK
автоматически ищется в `~/Library/Android/sdk`, `~/Documents/Processing/android/sdk`
и `~/Documents/ProcessingStudio/toolchain/android-sdk`. Для запуска на устройстве нужен `adb`.
Ошибки и вывод сборки видны в нижней части панели плагина.

Эмулятор поддерживает API, реализованный в Processing Studio. Полная совместимость
со всеми библиотеками Processing и Android Mode не гарантируется. Python Mode
в эмуляторе не поддерживается.

## Исходники и лицензия

`plugin.js` собран из `plugins/processing-mobile-src/` командой
`node scripts/build-processing-mobile.js`. Части эмулятора, транслятора и
экспортера взяты из [Processing Studio](https://github.com/ArduRadioKot/Processing-Studio)
и адаптированы для API плагинов FrogeeCodeIDE. Этот плагин распространяется по
GPL-2.0-only; текст лицензии в `LICENSE`.
