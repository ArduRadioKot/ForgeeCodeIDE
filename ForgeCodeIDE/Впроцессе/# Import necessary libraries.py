# Import necessary libraries
import tkinter as tk
import time

i=0
# Define the main function
def main():
    
    
    time.sleep(0.1)
    # Create a Tkinter window
    window = tk.Tk()

    # Set the window title
    #window.title("My Program")

    # Set the window size to 800x600 pixels
    window.geometry("800x600")

    # Load the image
    image = tk.PhotoImage(file="FogeCod.png")

    # Create a label and add the image to it
    label = tk.Label(window, image=image)

    # Pack the label into the window
    label.pack()

    # Start the Tkinter event loop
    window.mainloop()
def destroy():
      window = tk.Tk()
      window.destroy()




# Call the main function
if __name__ == "__main__":
    while i < 5:
      main()
      i+=1
      time.sleep(1)
    destroy()