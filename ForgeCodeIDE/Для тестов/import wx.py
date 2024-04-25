import wx
import wx.stc


class MyEditor (wx.stc.StyledTextCtrl):
  
    def __init__ (self, parent, id = wx.ID_ANY, \
            pos = wx.DefaultPosition, \
            size = wx.DefaultSize,\
            style = 0,\
            name = "editor"):
        wx.stc.StyledTextCtrl.__init__ (self, parent, id, pos, size, style, name)

        # Сделаем по умолчанию 14-й шрифт
        self.StyleSetSpec(wx.stc.STC_STYLE_DEFAULT, "size:%d" % 14)

        # Обработчик события "Добавление символа"
        self.Bind (wx.stc.EVT_STC_CHARADDED, self.onCharAdded)

    def onCharAdded (self, event):
        # Получим код нажатой клавиши
        key_val = event.GetKey()

        # Нас не интересуют нажатые клавиши с кодом больше 127
        if key_val > 127:
            return

        # Получим символ нажатой клавиши
        key = chr (key_val)

        # Варианты открывающихся скобок
        open = "{(["

        # Пары закрывающихся скобок к открывающимся
        close = "})]"

        keyindex = open.find (key)

        if keyindex != -1:
            pos = self.GetCurrentPos()
            text = self.GetText()

            self.AddText(close[keyindex] )

            # Установим каретку перед закрывающейся скобкой
            self.GotoPos (pos)



class MyFrame(wx.Frame):
    def __init__(self, *args, **kwds):
        kwds["style"] = wx.DEFAULT_FRAME_STYLE
        wx.Frame.__init__(self, *args, **kwds)

        self.SetTitle("Scintilla")

        sizer = wx.BoxSizer(wx.VERTICAL)       

        self.editor = MyEditor(self)
        sizer.Add (self.editor, 1, flag=wx.EXPAND)

        self.SetSizer(sizer)
        self.Layout()


if __name__ == "__main__":
    app = wx.PySimpleApp(0)
    wx.InitAllImageHandlers()
    frame_1 = MyFrame(None, -1, "")
    app.SetTopWindow(frame_1)
    frame_1.Show()
    app.MainLoop()
 