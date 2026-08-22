; case integration-006-reverse
; expect exit=0 stdout="dlrow olleh\na\n\nracecar\n"
.func main arity=0 locals=0
  CLOSURE rev
  PUSH_STR "hello world"
  CALL 1
  PRINT
  CLOSURE rev
  PUSH_STR "a"
  CALL 1
  PRINT
  CLOSURE rev
  PUSH_STR ""
  CALL 1
  PRINT
  CLOSURE rev
  PUSH_STR "racecar"
  CALL 1
  PRINT
  RET
.end
.func rev arity=1 locals=3
  PUSH_STR ""
  STORE_LOCAL 2
  PUSH_INT 0
  STORE_LOCAL 1
r_top:
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  LEN
  LT
  JMP_IF_FALSE r_end
  LOAD_LOCAL 0
  LOAD_LOCAL 0
  LEN
  LOAD_LOCAL 1
  SUB
  PUSH_INT 1
  SUB
  PUSH_INT 1
  SUBSTR
  LOAD_LOCAL 2
  SWAP
  CONCAT
  STORE_LOCAL 2
  LOAD_LOCAL 1
  PUSH_INT 1
  ADD
  STORE_LOCAL 1
  JMP r_top
r_end:
  LOAD_LOCAL 2
  RET
.end
