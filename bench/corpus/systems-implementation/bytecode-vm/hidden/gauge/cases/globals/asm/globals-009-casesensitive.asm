; case globals-009-casesensitive
; expect exit=0 stdout="1\n2\n"
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL abc
  PUSH_INT 2
  STORE_GLOBAL ABC
  LOAD_GLOBAL abc
  PRINT
  LOAD_GLOBAL ABC
  PRINT
  RET
.end
