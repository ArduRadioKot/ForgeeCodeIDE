import tkinter as tk
import subprocess

class CodeEditor(tk.Tk):
    def __init__(self):
        super().__init__()

        self.cpp_text = tk.Text(self)
        self.asm_text = tk.Text(self, state='disabled')

        self.cpp_text.pack(side='left', fill='both', expand=True)
        self.asm_text.pack(side='left', fill='both', expand=True)

        self.cpp_text.bind('<KeyRelease>', self.on_key_release)

    def on_key_release(self, event):
        self.asm_text.config(state='normal')
        self.asm_text.delete('1.0', 'end')

        try:
            output = subprocess.check_output(['g++', '-S', '-o', '-', '-x', 'c++', '-'],
                                             input=self.cpp_text.get('1.0', 'end-1c'),
                                             stderr=subprocess.STDOUT,
                                             universal_newlines=True)
            self.asm_text.insert('end', output)
        except subprocess.CalledProcessError as e:
            self.asm_text.insert('end', e.output)

        self.asm_text.config(state='disabled')

if __name__ == '__main__':
    app = CodeEditor()
    app.mainloop()