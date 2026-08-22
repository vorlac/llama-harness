; case strops-101-strtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_INT 1
  INDEXOF
  PRINT
  RET
.end
