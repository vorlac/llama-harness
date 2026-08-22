; case display-072-typeof
; expect exit=0 stdout="array\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  TYPEOF
  PRINT
  RET
.end
