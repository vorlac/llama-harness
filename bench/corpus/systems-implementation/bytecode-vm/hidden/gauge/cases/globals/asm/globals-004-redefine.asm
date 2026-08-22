; case globals-004-redefine
; expect exit=0 stdout="two\n"
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL v
  PUSH_STR "two"
  STORE_GLOBAL v
  LOAD_GLOBAL v
  PRINT
  RET
.end
