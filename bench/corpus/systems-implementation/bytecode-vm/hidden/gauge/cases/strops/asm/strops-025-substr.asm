; case strops-025-substr
; expect exit=0 stdout="\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_INT 0
  PUSH_INT 0
  SUBSTR
  PRINT
  RET
.end
