; case compare-164-lttype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "1"
  PUSH_INT 1
  LT
  PRINT
  RET
.end
