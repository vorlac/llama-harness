; case strops-021-substr
; expect exit=0 stdout="\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_INT 5
  PUSH_INT 0
  SUBSTR
  PRINT
  RET
.end
