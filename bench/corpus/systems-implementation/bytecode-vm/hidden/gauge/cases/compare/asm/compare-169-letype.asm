; case compare-169-letype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_STR "1"
  LE
  PRINT
  RET
.end
