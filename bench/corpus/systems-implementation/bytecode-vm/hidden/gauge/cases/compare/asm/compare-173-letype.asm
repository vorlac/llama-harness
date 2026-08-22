; case compare-173-letype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  NEW_ARRAY 0
  LE
  PRINT
  RET
.end
