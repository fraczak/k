# Chapter 1 — Introduction

## **1.1  The purpose of this book**

This book describes a small programming language called **k**.
It is meant to show how data can be represented and transformed in a uniform, precise way.

---

## **1.2  Data as trees**

All information in `k` is treated as a **tree**.
A tree has:

* a single root,
* labeled edges (field names or tags),
* and possibly subtrees.

A JSON object or an XML document are both trees in this sense.
Every k value is such a finite labeled tree.

---

## **1.3  Functions that may fail**

In ordinary mathematics a function always returns a result.
In `k`, a function may be **undefined** for some inputs.
For example, asking for the field `age` in a record that has no `age` is undefined.

We call such mappings **partial functions**.

---

## **1.4  Simplicity over features**

`k` avoids most language constructs: no *variables* and no *control statements*.
It has only:

1. **types** (which describe tree shapes), and
2. **partial functions** (which transform one tree into another).

These two ingredients are sufficient and powerful enough to express structured computation in a consise and understandable way.

There is another concept in the lanaguage, called **filters**.
The filters play a role in the process of resoning about types of partial functions.
They made to the syntax of the language as they allow explicit annotations of "polymorphic" expressions,
i.e., expressions which make sense in different contexts. 
They are similar to type classes in other languages.

---
