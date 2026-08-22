; case strops-028-substrrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_INT 0
  PUSH_INT -1
  SUBSTR
  PRINT
  RET
.end
