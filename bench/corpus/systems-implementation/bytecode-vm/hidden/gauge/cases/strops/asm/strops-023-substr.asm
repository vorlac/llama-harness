; case strops-023-substr
; expect exit=0 stdout="o\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_INT 4
  PUSH_INT 1
  SUBSTR
  PRINT
  RET
.end
