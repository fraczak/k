# Dependencies: pandoc, dejavu-fonts-all, texlive-xetex
all: book.pdf book.html book.tex

book-from-tex: book.tex
	xelatex book.tex

book.tex: book.md
	pandoc book.md -t latex -s -o book.tex

book.pdf: book.md
	pandoc book.md --pdf-engine=xelatex -V monofont="DejaVu Sans Mono" -V mainfont="DejaVu Serif" -o book.pdf

book.html: book.md
	pandoc book.md -o book.html

clean:
	rm -f book.pdf book.html book.tex *.aux *.log *.out

.PHONY: all clean book-from-tex
