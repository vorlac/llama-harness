; case strops-033-substrrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_INT 2
  PUSH_INT 2
  SUBSTR
  PRINT
  RET
.end
