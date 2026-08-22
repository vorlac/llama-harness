; case compare-167-lttype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  NEW_ARRAY 0
  LT
  PRINT
  RET
.end
