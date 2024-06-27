from tkinter import *
import tkinter.filedialog   #модуль filedialog для диалогов открытия/закрытия файла

def Quit(ev):
    global root
    root.destroy()
    
def LoadFile(ev):
    ftypes = [('Все файлы', '*'), ('txt файлы', '*.txt'), ('Файлы Python', '*.py'), ('Файлы html', '*.html')] # Фильтр файлов
    fn = tkinter.filedialog.Open(root, filetypes = ftypes).show()
    
    if fn == '':
        return  
    textbox.delete('1.0', 'end')    # Очищаем окно редактирования
    textbox.insert('1.0', open(fn).read())   # Вставляем текст в окно редактирования
   
     
    global cur_path
    cur_path = fn # Храним путь к открытому файлу
   
def SaveFile(ev):
    fn = tkinter.filedialog.SaveAs(root, filetypes = [('Все файлы', '*'), ('txt файлы', '*.txt'), ('Файлы Python', '*.py'), ('Файлы html', '*.html')]).show()
    if fn == '':
        return
    open(fn, 'wt').write(textbox.get('1.0', 'end'))

root = Tk()   # объект окна верхнего уровня создается от класса Tk модуля tkinter. 
#Переменную, связываемую с объектом, часто называют root (корень)

root.title(u'Текстовый редактор (.py, .txt, .html)')

panelFrame = Frame(root, height = 60, bg = 'gray')
textFrame = Frame(root, height = 340, width = 600)

panelFrame.pack(side = 'top', fill = 'x')   #упакуем с привязкой к верху
textFrame.pack(side = 'bottom', fill = 'both', expand = 1)  

textbox = Text(textFrame, font='Arial 14', wrap='word')  #перенос по словам метод wrap
scrollbar = Scrollbar(textFrame)

scrollbar['command'] = textbox.yview
textbox['yscrollcommand'] = scrollbar.set

textbox.pack(side = 'left', fill = 'both', expand = 1)  #текстбокс слева
scrollbar.pack(side = 'right', fill = 'y')    #расположим скролбар (лифт) справа

loadBtn = Button(panelFrame, text = 'Загрузить')
saveBtn = Button(panelFrame, text = 'Сохранить')
quitBtn = Button(panelFrame, text = 'Выход', bg='#A9A9A9',fg='#FF0000')

loadBtn.bind("<Button-1>", LoadFile)
saveBtn.bind("<Button-1>", SaveFile)
quitBtn.bind("<Button-1>", Quit)

loadBtn.place(x = 10, y = 10, width = 130, height = 40)
saveBtn.place(x = 150, y = 10, width = 130, height = 40)
quitBtn.place(x = 290, y = 10, width = 100, height = 40)

root.mainloop()