import tkinter as tk

class SimpleEditor(tk.Tk):
    def __init__(self):
        super().__init__()
        #self.root = root
        
        self.text = tk.Text(self, width=100, height=40)
        self.text.pack(side=tk.RIGHT,fill=tk.BOTH, expand=True)
        self.text.bind("<KeyRelease>", self.auto_brace)
        self.line_number_area = tk.Text(self, width=5, height=40)
        self.line_number_area.pack(side=tk.LEFT, fill=tk.Y)
        self.update_line_numbers()

    def auto_brace(self, event):
        if event.char in "{}[]()<>":
            self.text.insert(tk.INSERT, event.char)
            self.text.insert(tk.INSERT, self.get_closing_brace(event.char))
            self.text.mark_set("insert", tk.INSERT + 1)

    def get_closing_brace(self, char):
        braces = {"{": "}", "[": "]", "(": ")", "<":">"}
        return braces[char]
    
    def update_line_numbers(self):
        self.line_number_area.delete(1.0, tk.END)
        for i, line in enumerate(self.text.get("1.0", tk.END).split("\n"), start=1):
            self.line_number_area.insert(tk.END, f"{i}\n")
        self.after(100, self.update_line_numbers)

if __name__ == "__main__":
    #root = tk.Tk()
    editor = SimpleEditor()
    editor.mainloop()