; case strops-022-substr
; expect exit=0 stdout="ell\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_INT 1
  PUSH_INT 3
  SUBSTR
  PRINT
  RET
.end
