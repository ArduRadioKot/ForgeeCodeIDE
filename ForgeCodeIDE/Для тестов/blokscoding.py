import tkinter as tk
from tkinter import filedialog
from tkinter.scrolledtext import ScrolledText

class codeBlock:
    def __init__(self, master: tk.Tk):
        self.master = master
        self.master.title("blockcoding")
        self.master.geometry("1367x768")
        self.canvas = tk.Canvas(self.master, width=1200, height=1000000, bg="gray")
        self.canvas.pack(side="left")
        self.scroll_region = (0, 0, 1000, 1000)  # Set the scroll region to be larger than the canvas size
        self.canvas.config(scrollregion=self.scroll_region)
        
        self.elements = []
        self.trash_zone = tk.Frame(self.master, bg="red", width=100, height=200)
        self.trash_zone.pack(side="right", fill="both", expand=True)
        
        self.button_frame = tk.Frame(self.master)
        self.button_frame.pack()
        self.v_scroll = tk.Scrollbar(self.master, orient=tk.VERTICAL, command=self.canvas.yview)
        self.v_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.canvas.config(yscrollcommand=self.v_scroll.set)
        
        self.blocks = {
            'ledON': {'code': 'digitalWrite(LED_PIN, HIGH);', 'params': []},
            'ledOFF': {'code': 'digitalWrite(LED_PIN, LOW);', 'params': []},
            'loop': {'code': 'void endless_loop()', 'params': []},
            'if': {'code': 'if (%s) {\n    %s\n}', 'params': ['condition', 'body']},
            'buttonON': {'code': 'if (digitalRead(buttonPin) == HIGH)', 'params': []},
            'buttonOFF': {'code': 'if (digitalRead(buttonPin) == LOW)', 'params': []},
            'else': {'code': 'else', 'params':[]},
            'do': {'code': '{', 'params':[]},
            'end': {'code': '}', 'params':[]},

            # Add more blocks with corresponding C code
        }
        
        self.create_buttons()
        
        self.export_button = tk.Button(self.button_frame, text="Save", command=self.save_logical_elements)
        self.export_button.pack(fill="x")

        self.export_button = tk.Button(self.button_frame, text="Open", command=self.open_logical_elements)
        self.export_button.pack(fill="x")

        self.export_button = tk.Button(self.button_frame, text="Custom element", command=self.create_custom_element)
        self.export_button.pack(fill="x")

        self.export_button = tk.Button(self.button_frame, text="Export to C", command=self.export_to_c)
        self.export_button.pack(fill="x")

    def create_buttons(self):
        for block_name, block_info in self.blocks.items():
            button = tk.Button(self.button_frame, text=block_name, command=lambda block_name=block_name: self.create_block(block_name))
            button.pack(fill="x")

    def create_block(self, block_name):
        block_info = self.blocks[block_name]
        block = tk.Label(self.master, text=block_name, bg="white", fg="black")
        block.draggable = True
        block.bind("<ButtonPress-1>", self.start_drag)
        block.bind("<ButtonRelease-1>", self.stop_drag)
        block.bind("<B1-Motion>", self.drag)
        self.elements.append(block)
        self.canvas.create_window(10, 10, window=block)

    def start_drag(self, event: tk.Event):
        element = event.widget
        element.x0 = event.x
        element.y0 = event.y

    def stop_drag(self, event: tk.Event):
        element = event.widget
        if self.is_in_trash_zone(element):
            self.delete_element(element)

    def drag(self, event: tk.Event):
        element = event.widget
        dx = event.x - element.x0
        dy = event.y - element.y0
        element.place(x=element.winfo_x() + dx, y=element.winfo_y() + dy)
        element.x0 = event.x
        element.y0 = event.y

    def is_in_trash_zone(self, element: tk.Label):
        x, y = element.winfo_x(), element.winfo_y()
        return (x > self.trash_zone.winfo_x() and
                x < self.trash_zone.winfo_x() + self.trash_zone.winfo_width() and
                y > self.trash_zone.winfo_y() and
                y < self.trash_zone.winfo_y() + self.trash_zone.winfo_height())

    def delete_element(self, element: tk.Label):
        element.destroy()
        self.elements.remove(element)

    def export_to_c(self):
        code = ""
        for element in self.elements:
            block_name = element.cget("text")
            block_info = self.blocks[block_name]
            code += block_info["code"] % tuple(param.get() for param in block_info["params"]) + "\n"
        file_path = filedialog.asksaveasfilename(defaultextension=".c", filetypes=[('C files', '*.c')])
        if file_path:
            with open(file_path, "w") as f:
               f.write(code)

    def save_logical_elements(self):
        file_path = filedialog.asksaveasfilename(defaultextension=".fcb", filetypes=[('ForgeeCodeIDE_block', '*.fcb')])
        if file_path:
            with open(file_path, "w") as f:
                for element in self.elements:
                    x, y = element.winfo_rootx(), element.winfo_rooty()
                    f.write(f"{element.cget('text')} {x} {y}\n")
            print("Logical scheme saved to logical_scheme.lgs")

    def open_logical_elements(self):
        file_path = filedialog.askopenfilename(filetypes=[("ForgeeCodeIDE_block", "*.fcb")])
        if file_path:
            self.elements = []
            with open(file_path, "r") as f:
                for line in f:
                    text, x, y = line.strip().split()
                    x, y = int(x), int(y)
                    element = tk.Label(self.master, text=text, bg="white", fg="black", width=5, height=2)
                    element.place(x=x, y=y)
                    element.draggable = True
                    element.bind("<ButtonPress-1>", self.start_drag)
                    element.bind("<ButtonRelease-1>", self.stop_drag)
                    element.bind("<B1-Motion>", self.drag)
                    self.elements.append(element)

    def create_custom_element(self):
        custom_element_window = tk.Toplevel(self.master)
        custom_element_window.title("Create Custom Logical Element")

        text_editor = ScrolledText(custom_element_window, width=40, height=10)
        text_editor.pack(fill="both", expand=True)

        create_button = tk.Button(custom_element_window, text="Create", command=lambda: self.add_custom_element(text_editor.get("1.0", "1.0 lineend")))
        create_button.pack()

    def add_custom_element(self, element_text: str):
        custom_element = tk.Label(self.master, text=element_text, bg="white", fg="black")
        custom_element.draggable = True
        custom_element.bind("<ButtonPress-1>", self.start_drag)
        custom_element.bind("<ButtonRelease-1>", self.stop_drag)
        custom_element.bind("<B1-Motion>", self.drag)
        self.elements.append(custom_element)
        self.canvas.create_window(10, 10, window=custom_element)

    # Save the custom element's source code to a separate Python file
        file_path = filedialog.asksaveasfilename(defaultextension=".py", filetypes=[('Python files', '*.py')])
        if file_path:
             with open(file_path, "w") as f:
                  f.write(f"custom_element = tk.Label(self.master, text='{element_text}', bg='white', fg='black')\n")
                  f.write("custom_element.draggable = True\n")
                  f.write("custom_element.bind('<ButtonPress-1>', self.start_drag)\n")
                  f.write("custom_element.bind('<ButtonRelease-1>', self.stop_drag)\n")
                  f.write("custom_element.bind('<B1-Motion>', self.drag)\n")
                  f.write("self.elements.append(custom_element)\n")
                  f.write("self.canvas.create_window(10, 10, window=custom_element)\n")

root = tk.Tk()
drag_and_drop_constructor = codeBlock(root)
root.mainloop()