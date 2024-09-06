import tkinter as tk
from tkinter import filedialog, messagebox
import serial
import serial.tools.list_ports
import subprocess
import os

class ArduinoIDE:
    def __init__(self, root):
        self.root = root
        self.root.title("Forge Code IDE")
        self.root.geometry("800x600")

        # Create menu
        self.menu = tk.Menu(self.root)
        self.root.config(menu=self.menu)

        self.file_menu = tk.Menu(self.menu, tearoff=0)
        self.file_menu.add_command(label="Open", command=self.open_file)
        self.file_menu.add_command(label="Save", command=self.save_file)
        self.file_menu.add_separator()
        self.file_menu.add_command(label="Exit", command=self.root.quit)
        self.menu.add_cascade(label="File", menu=self.file_menu)

        # Create text area
        self.text_area = tk.Text(self.root, width=80, height=30)
        self.text_area.pack(fill="both", expand=True)

        # Create serial port selection frame
        self.serial_port_frame = tk.Frame(self.root)
        self.serial_port_frame.pack(fill="x")

        self.port_label = tk.Label(self.serial_port_frame, text="Port:")
        self.port_label.pack(side="left")

        self.port_var = tk.StringVar()
        self.port_var.set("Select port")
        self.port_menu = tk.OptionMenu(self.serial_port_frame, self.port_var, *self.get_serial_ports())
        self.port_menu.pack(side="left")

        self.speed_label = tk.Label(self.serial_port_frame, text="Speed:")
        self.speed_label.pack(side="left")

        self.speed_var = tk.StringVar()
        self.speed_var.set("9600")
        self.speed_menu = tk.OptionMenu(self.serial_port_frame, self.speed_var, "9600", "19200", "38400", "57600", "115200")
        self.speed_menu.pack(side="left")

        # Create upload button
        self.upload_button = tk.Button(self.serial_port_frame, text="Upload", command=self.upload_code)
        self.upload_button.pack(side="left")

    def get_serial_ports(self):
        return [port.device for port in serial.tools.list_ports.comports()]

    def open_file(self):
        file_path = filedialog.askopenfilename()
        if file_path:
            with open(file_path, "r") as f:
                self.text_area.delete("1.0", "end")
                self.text_area.insert("1.0", f.read())

    def save_file(self):
        file_path = filedialog.asksaveasfilename(defaultextension=".ino")
        if file_path:
            with open(file_path, "w") as f:
                f.write(self.text_area.get("1.0", "end-1c"))

    def compile_code(self, code):
        # Create a temporary file for the Arduino code
        with open("temp.ino", "w") as f:
            f.write(code)

        # Compile the code using the Arduino CLI compiler
        try:
            output = subprocess.check_output(["arduino-cli", "compile", "--fqbn", "arduino:avr:uno", "temp.ino"])
            compiled_code = output.decode("utf-8")
        except subprocess.CalledProcessError as e:
            raise Exception("Compilation failed: " + str(e))

        # Remove the temporary file
        os.remove("temp.ino")

        return compiled_code

    def upload_code(self):
        port = self.port_var.get()
        speed = self.speed_var.get()
        code = self.text_area.get("1.0", "end-1c")
        try:
            # Compile the code using the custom compile_code function
            compiled_code = self.compile_code(code)
            # Open the serial connection
            ser = serial.Serial(port, int(speed), timeout=1)
            # Upload the compiled code to Arduino
            ser.write(compiled_code.encode("utf-8"))
            ser.close()
            messagebox.showinfo("Успех", "Код загружен успешно")
        except Exception as e:
            messagebox.showerror("Ошибка", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    ide = ArduinoIDE(root)
    root.mainloop()