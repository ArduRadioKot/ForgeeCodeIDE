// ==FrogeePlugin==
// @name        Вставить дату
// @version     1.0
// @description Кнопка на левой панели вставляет сегодняшнюю дату и время
// @author      FrogeeSoft
// ==/FrogeePlugin==
fgs.addButton({
    title: 'Вставить дату и время',
    icon: 'calendar',
    run: editor => {
        editor.insert(new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }));
        fgs.notify('Дата вставлена');
    }
});
