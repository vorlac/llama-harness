; case compare-179-gttype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  NEW_ARRAY 0
  GT
  PRINT
  RET
.end
