import customtkinter as ctk
from tkinter import simpledialog, filedialog, messagebox
from customtkinter import CTk, CTkLabel, CTkButton,  CTkToplevel, CTkImage
import tkinter as tk
from PIL import Image, ImageTk
import os
ctk.set_appearance_mode("System")  # Modes: "System" (standard), "Dark", "Light"
ctk.set_default_color_theme("green") 


class FrogeeCode(ctk.CTk):
    def __init__(self, master=None):
        super().__init__()
        current_dir = os.path.dirname(__file__)
        image_dir = os.path.join(current_dir, 'FCIDEimages')

        self.run_icon = ImageTk.PhotoImage(Image.open(os.path.join(image_dir, "run.png")).resize((20, 20)))
        self.new_icon = ImageTk.PhotoImage(Image.open(os.path.join(image_dir, "new.png")).resize((20, 20)))
        self.open_icon = ImageTk.PhotoImage(Image.open(os.path.join(image_dir, "open.png")).resize((20, 20)))
        self.save_icon = ImageTk.PhotoImage(Image.open(os.path.join(image_dir, "save.png")).resize((20, 20)))
        self.settings_icon = ImageTk.PhotoImage(Image.open(os.path.join(image_dir, "settings.png")).resize((20, 20)))
        self.quit_icon = ImageTk.PhotoImage(Image.open(os.path.join(image_dir, "quit.png")).resize((20, 20)))
        self.title("FrogeeCodeIDE")
        self.geometry("800x600")
        self.root = ctk.CTk()
        self.scrollbar = tk.Scrollbar(self)
        self.scrollbar.pack(side="right", fill="y")

        self.text_area = tk.Text(self, font=("Consolas", 12), width=16, height=4, yscrollcommand=self.scrollbar.set)
        self.text_area.pack(fill="both", side=ctk.RIGHT, padx=0)

        self.scrollbar.config(command=self.text_area.yview)
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

        self.toolbar = ctk.CTkFrame(self.master, width=20, height=768)
        self.toolbar.pack(side="left", fill="y")
        self.text_area.bind("<Key>", self.auto_brace)
        self.text_area.bind("<KeyRelease>", self.highlight_syntax_realtime)  
        self.line_number_area = tk.Text(self, width=5, height=40, font=("Consolas", 12))
        self.line_number_area.pack(side=ctk.LEFT, fill="y", padx=0)
        
        self.new_button = ctk.CTkButton(self.toolbar, image=self.new_icon, text="", width=15)
        self.new_button.pack(fill="x", pady=10)

        self.open_button = ctk.CTkButton(self.toolbar, image=self.open_icon, text="", width=15)
        self.open_button.pack(fill="x", pady=10)

        self.save_button = ctk.CTkButton(self.toolbar, image=self.save_icon, text="", width=15)
        self.save_button.pack(fill="x", pady=10)


        self.run_button = ctk.CTkButton(self.toolbar, image=self.run_icon, text="", width=15 )
        self.run_button.pack(fill="x", pady=10)

        self.settings_button = ctk.CTkButton(self.toolbar, image=self.settings_icon, text="", width=15, command=self.open_settings)
        self.settings_button.pack(fill="x", pady=190)

        self.quit_button = ctk.CTkButton(self.toolbar, image=self.quit_icon, text="", width=15)
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

    def open_settings(self):
        self.settings_window = ctk.CTkToplevel(self)
        self.settings_window.title("Settings")
        self.settings_window.geometry("300x200")

        self.font_size_label = ctk.CTkLabel(self.settings_window, text="Font Size:")
        self.font_size_label.pack(pady=10)

        self.font_size_entry = ctk.CTkEntry(self.settings_window, width=20)
        self.font_size_entry.pack(pady=10)

        self.theme_label = ctk.CTkLabel(self.settings_window, text="Theme:")
        self.theme_label.pack(pady=10)

        self.appearance_mode_label = ctk.CTkLabel(self.settings_window, text="Appearance Mode:")
        self.appearance_mode_label.pack(fill="x", pady=10)
        self.appearance_mode_optionemenu = ctk.CTkOptionMenu(self.settings_window, values=["Dark", "Light", "System"], command=self.change_appearance_mode_event)
        self.appearance_mode_optionemenu.pack(fill="x", pady=10)
        self.scaling_label = ctk.CTkLabel(self.settings_window, text="UI Scaling:")
        self.scaling_label.pack(fill="x", pady=10)
        self.scaling_optionemenu = ctk.CTkOptionMenu(self.settings_window, values=["80%", "90%", "100%", "110%", "120%"], command=self.change_scaling_event)

        self.scaling_entry = ctk.CTkEntry(self.settings_window, width=20)
        self.scaling_entry.pack(pady=10)

        self.apply_button = ctk.CTkButton(self.settings_window, text="Apply", command=self.apply_settings)
        self.apply_button.pack(pady=10)

        self.cancel_button = ctk.CTkButton(self.settings_window, text="Cancel", command=self.settings_window.destroy)
        self.cancel_button.pack(pady=10)

    def apply_settings(self):
        font_size = int(self.font_size_entry.get())
        theme = self.theme_option.get()
        scaling = int(self.scaling_entry.get()) / 100

    # Save settings to a file or database
        with open("settings.cfg", "w") as f:
            f.write(f"font_size={font_size}\n")
            f.write(f"theme={theme}\n")
            f.write(f"scaling={scaling}\n")

    # Apply settings to the main application
        self.change_appearance_mode_event(theme)
        self.change_scaling_event(f"{scaling*100}%")
        self.text_area.config(font=("Consolas", font_size))  # Update the text area font
        self.line_number_area.config(font=("Consolas", font_size))  # Update the line number area font

        
    def update_widgets(self):
        for widget in self.winfo_children():
            if isinstance(widget, ctk.CTkButton):
                widget.config(font=("Consolas", int(self.scaling_entry.get())))
            elif isinstance(widget, ctk.CTkLabel):
                widget.config(font=("Consolas", int(self.scaling_entry.get())))
        # Update other widgets as needed

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