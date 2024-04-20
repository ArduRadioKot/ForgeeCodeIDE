#include <iostream>
#include <fstream>
#include <string>

int main() {
    std::string code;
    std::ofstream file;
    std::cout << "Enter your C or C++ code:\n";
    std::getline(std::cin, code);
    file.open("code.cpp");
    file << code;
    file.close();
    system("g++ code.cpp -o code");
    system("./code");
    return 0;
}№