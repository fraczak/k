PAPER = k-paper
TEX = pdflatex -interaction=nonstopmode

.PHONY: all pdf clean arxiv

all: pdf

pdf: $(PAPER).tex
	$(TEX) $(PAPER).tex
	$(TEX) $(PAPER).tex

arxiv: pdf
	tar -czvf arxiv-submission.tar.gz $(PAPER).tex
	@echo "Created arxiv-submission.tar.gz for arXiv upload"

clean:
	rm -f $(PAPER).aux $(PAPER).log $(PAPER).out $(PAPER).toc $(PAPER).pdf arxiv-submission.tar.gz
