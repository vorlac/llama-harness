; case gc-011-substr
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_INT 0
  PUSH_INT 2
  SUBSTR
  GCLIVE
  PRINT
  RET
.end
