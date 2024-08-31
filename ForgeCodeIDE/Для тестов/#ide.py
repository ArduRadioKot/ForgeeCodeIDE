import customtkinter as ctk
from tkinter import simpledialog, filedialog, messagebox
from customtkinter import CTk, CTkLabel, CTkButton,  CTkToplevel, CTkImage
import tkinter as tk
from PIL import Image, ImageTk
ctk.set_appearance_mode("System")  # Modes: "System" (standard), "Dark", "Light"
ctk.set_default_color_theme("green") 


class FrogeeCode(ctk.CTk):
    def __init__(self, master=None):
        super().__init__()
        run_image = Image.open("run.png")
        run_image = run_image.resize((20, 20))
        run_icon = ImageTk.PhotoImage(run_image)

        new_image = Image.open("new.png")
        new_image = new_image.resize((20, 20))
        new_icon = ImageTk.PhotoImage(new_image)

        open_image = Image.open("open.png")
        open_image = open_image.resize((20, 20))
        open_icon = ImageTk.PhotoImage(open_image)

        save_image = Image.open("save.png")
        save_image = save_image.resize((20, 20))
        save_icon = ImageTk.PhotoImage(save_image)

        settings_image = Image.open("settings.png")
        settings_image = settings_image.resize((20, 20))
        settings_icon = ImageTk.PhotoImage(settings_image)

        quit_image = Image.open("quit.png")
        quit_image = quit_image.resize((20, 20))
        quit_icon = ImageTk.PhotoImage(quit_image)
        
        self.title("FrogeeCodeIDE")
        self.geometry("800x600")
        self.root = ctk.CTk()
        self.text_area = tk.Text(self, font=("Consolas", 12))
        self.text_area.pack(fill="both", side=ctk.RIGHT, expand=True, padx=0)
        self.text_area.tag_config('keyword', foreground='#ad82e0')  # purple
        self.text_area.tag_config('builtin', foreground='#3ea8e5')  # blue-violet
        self.text_area.tag_config('string', foreground='#6a8759')  # green
        self.text_area.tag_config('comment', foreground='#546e56')  # dark green
        self.text_area.tag_config('unknown', foreground='#84adf0')  # blue-violet
        self.text_area.tag_config('class', foreground='#48b083')  # green-blue
        self.text_area.tag_config('clas', foreground='#477ad1')  # green-blue
        self.text_area.tag_config('def_func', foreground='#dee86d')  # light green

        self.keywords = ['if', 'else', 'for', 'while', 'import']
        self.builtins = ['self', 'print', 'len', 'range', 'list', 'dict', 'set', 'int', 'float', 'str', 'bool']
        self.strings = ['"', "'", '"""', "'''"]
        self.comments = ['#']
        self.clas = ['class', 'def']

        self.toolbar = ctk.CTkFrame(self.master, width=15, height=768)
        self.toolbar.pack(side="left", fill="y")
        # self.text_area.bind("<KeyRelease>", self.auto_brace)
        self.text_area.bind("<KeyRelease>", self.highlight_syntax_realtime)  
        self.line_number_area = tk.Text(self, width=5, height=400, font=("Consolas", 12))
        self.line_number_area.pack(side=ctk.LEFT, fill="y", padx=10)
        
        self.new_button = ctk.CTkButton(self.toolbar, image=new_icon, text="", width=15)
        self.new_button.pack(fill="x", pady=10)

        self.open_button = ctk.CTkButton(self.toolbar, image=open_icon, text="", width=15)
        self.open_button.pack(fill="x", pady=10)

        self.save_button = ctk.CTkButton(self.toolbar, image=save_icon, text="", width=15)
        self.save_button.pack(fill="x", pady=10)


        self.run_button = ctk.CTkButton(self.toolbar, image=run_icon, text="", width=15 )
        self.run_button.pack(fill="x", pady=10)

        self.settings_button = ctk.CTkButton(self.toolbar, image=settings_icon, text="", width=15)
        self.settings_button.pack(fill="x", pady=170)

        self.quit_button = ctk.CTkButton(self.toolbar, image=quit_icon, text="", width=15)
        self.quit_button.pack(fill="x", pady=10)

        self.update_line_numbers()
        
    def auto_brace(self, event):
        if event.char in "{}[]()<>":
            self.text_area.insert("insert", event.char)
            self.text_area.insert("insert", self.get_closing_brace(event.char))
            self.text_area.mark_set("insert", "insert -1c")

    def get_closing_brace(self, char):
        braces = {"{": "}", "[": "]", "(": ")", "<":">"}
        return braces[char]

    def update_line_numbers(self):
        self.line_number_area.delete("1.0", "end")
        for i, line in enumerate(self.text_area.get("1.0", "end").split("\n"), start=1):
            self.line_number_area.insert("end", f"{i}\n")
        self.after(100, self.update_line_numbers)

    def highlight_syntax_realtime(self, event):
        self.text_area.tag_remove('keyword', '1.0', 'end')
        self.text_area.tag_remove('builtin', '1.0', 'end')
        self.text_area.tag_remove('string', '1.0', 'end')
        self.text_area.tag_remove('comment', '1.0', 'end')
        self.text_area.tag_remove('unknown', '1.0', 'end')
        self.text_area.tag_remove('class', '1.0', 'end')
        self.text_area.tag_remove('clas', '1.0', 'end')
        self.text_area.tag_remove('def_func', '1.0', 'end')

        text = self.text_area.get('1.0', 'end-1c')
        lines = text.split('\n')

        for i, line in enumerate(lines, 1):
            words = line.split()
            for j, word in enumerate(words):
                if word in self.keywords:
                    start = f'{i}.{line.index(word)}'
                    end = f'{i}.{line.index(word) + len(word)}'
                    self.text_area.tag_add('keyword', start, end)

                elif word in self.builtins:
                    start = f'{i}.{line.index(word)}'
                    end = f'{i}.{line.index(word) + len(word)}'
                    self.text_area.tag_add('builtin', start, end)

                elif word == 'class':
                    start = f'{i}.{line.index(word)}'
                    end = f'{i}.{line.index(word) + len(word)}'
                    self.text_area.tag_add('clas', start, end)

                    if j + 1 < len(words):
                        next_word = words[j + 1]
                        start = f'{i}.{line.index(next_word)}'
                        end = f'{i}.{line.index(next_word) + len(next_word)}'
                        self.text_area.tag_add('class', start, end)

                elif word == 'def':
                    start = f'{i}.{line.index(word)}'
                    end = f'{i}.{line.index(word) + len(word)}'
                    self.text_area.tag_add('clas', start, end)

                    if j + 1 < len(words):
                        next_word = words[j + 1]
                        start = f'{i}.{line.index(next_word)}'
                        end = f'{i}.{line.index(next_word) + len(next_word)}'
                        self.text_area.tag_add('def_func', start, end)

                elif word.endswith('__') or word.endswith('.__'):  # Check for class names
                    start = f'{i}.{line.index(word)}'
                    end = f'{i}.{line.index(word) + len(word)}'
                    self.text_area.tag_add('class', start, end)

                elif word not in self.keywords and word not in self.builtins and not word.isdigit():
                    start = f'{i}.{line.index(word)}'
                    end = f'{i}.{line.index(word) + len(word)}'
                    self.text_area.tag_add('unknown', start, end)

            for string in self.strings:
                if string in line:
                    start = f'{i}.{line.index(string)}'
                    end = f'{i}.{line.index(string) + len(string)}'
                    self.text_area.tag_add('string', start, end)

            for comment in self.comments:
                if comment in line:
                    start = f'{i}.{line.index(comment)}'
                    end = f'{i}.end'
                    self.text_area.tag_add('comment', start, end)


    def change_appearance_mode_event(self, new_appearance_mode: str):
        ctk.set_appearance_mode(new_appearance_mode)

    def change_scaling_event(self, new_scaling: str):
        new_scaling_float = int(new_scaling.replace("%", "")) / 100
        ctk.set_widget_scaling(new_scaling_float)



    def run(self):
        self.mainloop()

if __name__ == "__main__":
    app = FrogeeCode()
    app.run()