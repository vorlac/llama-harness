; case compare-166-lttype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_FALSE
  LT
  PRINT
  RET
.end
