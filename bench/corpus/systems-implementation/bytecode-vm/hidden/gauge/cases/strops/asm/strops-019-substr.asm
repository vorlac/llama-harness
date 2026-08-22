; case strops-019-substr
; expect exit=0 stdout="hello\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_INT 0
  PUSH_INT 5
  SUBSTR
  PRINT
  RET
.end
