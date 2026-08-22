; case integration-010-wordcount
; expect exit=0 stdout="9\n"
.func main arity=0 locals=3
  PUSH_STR "the quick brown fox jumps over the lazy dog"
  STORE_LOCAL 0
  PUSH_INT 1
  STORE_LOCAL 2
  PUSH_INT 0
  STORE_LOCAL 1
w_top:
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  LEN
  LT
  JMP_IF_FALSE w_end
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  PUSH_INT 1
  SUBSTR
  PUSH_STR " "
  EQ
  JMP_IF_FALSE nospace
  LOAD_LOCAL 2
  PUSH_INT 1
  ADD
  STORE_LOCAL 2
nospace:
  LOAD_LOCAL 1
  PUSH_INT 1
  ADD
  STORE_LOCAL 1
  JMP w_top
w_end:
  LOAD_LOCAL 2
  PRINT
  RET
.end
