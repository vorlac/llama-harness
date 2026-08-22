; case arrays-036-shared
; expect exit=0 stdout="[[], []]\n"
.func main arity=0 locals=1
  NEW_ARRAY 0
  STORE_LOCAL 0
  LOAD_LOCAL 0
  LOAD_LOCAL 0
  NEW_ARRAY 2
  PRINT
  RET
.end
